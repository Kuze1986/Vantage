/**
 * Billing routes — plan state, Checkout, and the Customer Portal.
 *
 * Vantage never touches card data: Checkout collects it, the Portal manages it.
 * This route only creates sessions and reports what the workspace is entitled to.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { PLANS, planFor, type PlanKey } from "../lib/plans.js";
import { getUsage, loadSubscription } from "../lib/usage.js";
import {
  getStripe,
  integrationIdentifier,
  isStripeConfigured,
  resolvePriceId,
  type BillingInterval,
} from "../lib/stripe.js";

export const billingRoutes = new Hono();

const checkoutSchema = z.object({
  plan:     z.enum(["starter", "growth", "scale"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

/** Where Stripe returns the customer. Falls back to the API's own origin. */
function appUrl(): string {
  return process.env.APP_BASE_URL ?? process.env.VITE_APP_URL ?? "http://localhost:5173";
}

// GET /v1/billing — current plan, usage against limits, and the catalogue.
billingRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const sub = await loadSubscription(ws);
  const usage = await getUsage(ws, sub);

  return c.json({
    plan: usage.plan,
    subscription: sub
      ? {
          status: sub.status,
          plan_key: sub.plan_key,
          current_period_end: sub.current_period_end,
        }
      : null,
    usage: {
      period_start: usage.period_start,
      used: usage.used,
      limits: usage.limits,
    },
    plans: PLANS,
    // The UI hides checkout entirely rather than offering a button that 500s.
    stripe_configured: isStripeConfigured(),
  });
});

// POST /v1/billing/checkout — start a subscription.
billingRoutes.post("/checkout", async (c) => {
  if (!isStripeConfigured()) {
    throw new HTTPException(503, { message: "Billing is not configured on this deployment" });
  }
  const ws = c.get("workspaceId");
  const role = c.get("workspaceRole");
  // Paying for the workspace is an owner/admin action, not an editor's.
  if (role !== "owner" && role !== "admin") {
    throw new HTTPException(403, { message: "Only workspace owners and admins can manage billing" });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = checkoutSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const plan = parsed.data.plan as PlanKey;
  const interval = parsed.data.interval as BillingInterval;

  let priceId: string;
  try {
    priceId = resolvePriceId(plan, interval);
  } catch (err) {
    throw new HTTPException(503, { message: err instanceof Error ? err.message : "Price not configured" });
  }

  const stripe = getStripe();
  const sb = getSupabaseAdmin();

  // Reuse this workspace's Stripe customer so a second subscription doesn't
  // create a duplicate customer with a separate payment method and history.
  const { data: existing } = await sb
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("workspace_id", ws)
    .maybeSingle();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    // No payment_method_types — Stripe picks eligible methods dynamically from
    // Dashboard settings. Hardcoding "card" would lock out better-converting
    // methods.
    line_items: [{ price: priceId, quantity: 1 }],
    ...(existing?.stripe_customer_id
      ? { customer: existing.stripe_customer_id as string }
      : {}),
    subscription_data: {
      trial_period_days: 14,
      // Stamped on the subscription too, so a webhook that arrives without the
      // session (subscription.updated) can still resolve the workspace.
      metadata: { workspace_id: ws },
    },
    metadata: { workspace_id: ws, plan, interval },
    client_reference_id: ws,
    integration_identifier: integrationIdentifier(),
    success_url: `${appUrl()}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/settings?billing=cancelled`,
  });

  await logActivity({
    source: "billing", source_type: "system",
    event_type: "checkout_started",
    summary: `Checkout started for ${planFor(plan).label} (${interval})`,
    payload: { session_id: session.id, plan, interval },
    workspace_id: ws,
  });

  return c.json({ url: session.url, session_id: session.id });
});

// POST /v1/billing/portal — self-serve plan changes, payment method, cancellation.
billingRoutes.post("/portal", async (c) => {
  if (!isStripeConfigured()) {
    throw new HTTPException(503, { message: "Billing is not configured on this deployment" });
  }
  const ws = c.get("workspaceId");
  const role = c.get("workspaceRole");
  if (role !== "owner" && role !== "admin") {
    throw new HTTPException(403, { message: "Only workspace owners and admins can manage billing" });
  }

  const sb = getSupabaseAdmin();
  const { data: customer } = await sb
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("workspace_id", ws)
    .maybeSingle();

  if (!customer?.stripe_customer_id) {
    throw new HTTPException(400, { message: "No billing account yet — subscribe first" });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id as string,
    return_url: `${appUrl()}/settings`,
  });

  return c.json({ url: session.url });
});
