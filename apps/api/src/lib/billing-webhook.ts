/**
 * Stripe webhook handling, split from the route so the branching is testable
 * without standing up a Hono request.
 *
 * Two rules this encodes, both learned the hard way in the sibling DemoGate
 * integration:
 *
 *  1. **Resolve the workspace from metadata or the customer id, never email.**
 *     A customer changing their email in Stripe must not orphan their
 *     subscription. Ids are immutable; email is not.
 *  2. **Every event is deduped.** Stripe redelivers on any non-2xx, and a
 *     replayed `invoice.paid` that reset a usage counter twice would silently
 *     hand a customer a second month's allowance.
 */
import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabase.js";
import { logActivity } from "./activity.js";
import {
  planFromPriceId,
  subscriptionPeriodEnd,
  subscriptionPriceId,
} from "./stripe.js";

/** True when this event id has already been processed. */
export async function alreadyProcessed(eventId: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

export async function markProcessed(event: Stripe.Event): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("billing_events").insert({
    stripe_event_id: event.id,
    type: event.type,
    payload: JSON.parse(JSON.stringify(event.data.object)) as Record<string, unknown>,
  });
  // 23505 = another concurrent delivery inserted first. That is the dedupe
  // working, not a failure.
  if (error && (error as { code?: string }).code !== "23505") {
    throw new Error(error.message);
  }
}

/**
 * Find the workspace an event belongs to.
 *
 * Order matters: explicit metadata beats a database lookup, because a brand-new
 * subscription's customer row may not exist yet when the first event lands.
 */
export async function resolveWorkspaceId(opts: {
  metadataWorkspaceId?: string | null;
  clientReferenceId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  const fromMeta = opts.metadataWorkspaceId ?? opts.clientReferenceId ?? null;
  if (fromMeta) return fromMeta;
  if (!opts.stripeCustomerId) return null;

  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("billing_customers")
    .select("workspace_id")
    .eq("stripe_customer_id", opts.stripeCustomerId)
    .maybeSingle();
  return (data?.workspace_id as string | undefined) ?? null;
}

export async function upsertCustomer(opts: {
  workspaceId: string;
  stripeCustomerId: string;
  email: string | null;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("billing_customers").upsert(
    {
      workspace_id: opts.workspaceId,
      stripe_customer_id: opts.stripeCustomerId,
      email: opts.email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
}

/** Mirror a Stripe subscription onto the workspace, resolving its plan. */
export async function upsertSubscription(workspaceId: string, sub: Stripe.Subscription): Promise<void> {
  const sb = getSupabaseAdmin();
  const priceId = subscriptionPriceId(sub);
  const planKey = planFromPriceId(priceId);
  const periodEnd = subscriptionPeriodEnd(sub);

  const { data: customer } = await sb
    .from("billing_customers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  await sb.from("billing_subscriptions").upsert(
    {
      workspace_id: workspaceId,
      billing_customer_id: (customer?.id as string | undefined) ?? null,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      plan_key: planKey,
      current_period_end: periodEnd ? periodEnd.toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  await logActivity({
    source: "billing", source_type: "system",
    event_type: "subscription_updated",
    summary: `Subscription ${sub.status}${planKey ? ` on ${planKey}` : ""}`,
    payload: { subscription_id: sub.id, status: sub.status, plan_key: planKey, price_id: priceId },
    workspace_id: workspaceId,
  });

  if (!planKey && priceId) {
    // A live price id no env var matches. The subscription is real and the
    // customer is paying, but quota would silently fall back to trial — worth
    // shouting about rather than swallowing.
    console.warn(`[billing] price ${priceId} maps to no known plan — check STRIPE_PRICE_* env`);
  }
}

export async function recordInvoice(workspaceId: string | null, invoice: Stripe.Invoice): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("billing_invoices").upsert(
    {
      workspace_id: workspaceId,
      stripe_invoice_id: invoice.id ?? null,
      amount_paid: invoice.amount_paid ?? null,
      currency: invoice.currency ?? null,
      status: invoice.status ?? null,
    },
    { onConflict: "stripe_invoice_id" },
  );
}
