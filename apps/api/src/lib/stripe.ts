/**
 * Stripe client and catalogue mapping.
 *
 * Catalogue modelling: each tier is its own Stripe **Product**, with monthly and
 * annual **Prices** attached to it. Tiers must not share a Product — Checkout
 * and invoices render the Product name per line item, so a shared Product makes
 * every line read identically and a customer cannot tell what they bought.
 */
import Stripe from "stripe";
import type { PlanKey } from "./plans.js";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  client = new Stripe(key, {
    // Pinned to the version this SDK major ships with (stripe@22.4.0).
    // Bumping the SDK without bumping this — or the reverse — is how billing
    // integrations break silently. Two field moves in this range are handled by
    // the shims below.
    apiVersion: "2026-07-29.dahlia",
    typescript: true,
  });
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Env var holding the Stripe price id for each (tier × interval). */
export const PRICE_ENV: Record<string, string> = {
  starter_monthly: "STRIPE_PRICE_STARTER_MONTHLY",
  starter_annual:  "STRIPE_PRICE_STARTER_ANNUAL",
  growth_monthly:  "STRIPE_PRICE_GROWTH_MONTHLY",
  growth_annual:   "STRIPE_PRICE_GROWTH_ANNUAL",
  scale_monthly:   "STRIPE_PRICE_SCALE_MONTHLY",
  scale_annual:    "STRIPE_PRICE_SCALE_ANNUAL",
};

export type BillingInterval = "monthly" | "annual";

export function priceKeyFor(plan: PlanKey, interval: BillingInterval): string {
  return `${plan}_${interval}`;
}

/** Resolve a configured price id, or throw naming the missing variable. */
export function resolvePriceId(plan: PlanKey, interval: BillingInterval): string {
  const envName = PRICE_ENV[priceKeyFor(plan, interval)];
  if (!envName) throw new Error(`No Stripe price configured for ${plan}/${interval}`);
  const id = process.env[envName];
  if (!id) throw new Error(`Missing environment variable ${envName}`);
  return id;
}

/**
 * Reverse map: Stripe price id → plan key. Both intervals of a tier resolve to
 * the same plan, since quota does not differ by billing frequency.
 *
 * Built at call time rather than module load so a price id added to the
 * environment takes effect without a restart.
 */
export function planFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const [key, envName] of Object.entries(PRICE_ENV)) {
    if (process.env[envName] && process.env[envName] === priceId) {
      return key.split("_")[0] as PlanKey;
    }
  }
  return null;
}

/**
 * Stripe moved subscription period timestamps from the subscription object onto
 * its items in the 2026 API versions. Reading `sub.current_period_end` directly
 * yields undefined after an API-version bump, which writes a null period end and
 * makes every subscription look expired — silently, with no error.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const top = (sub as { current_period_end?: number | null }).current_period_end;
  const item = sub.items?.data?.[0] as { current_period_end?: number | null } | undefined;
  const ts = top ?? item?.current_period_end ?? null;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

/**
 * `invoice.subscription` was replaced by
 * `invoice.parent.subscription_details.subscription`. Accept both, so the
 * handler works either side of an API-version bump.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return String(legacy.id);
  const parent = (invoice as {
    parent?: { subscription_details?: { subscription?: string | null } | null } | null;
  }).parent;
  return parent?.subscription_details?.subscription ?? null;
}

/** First price id on a subscription, which is the tier the customer bought. */
export function subscriptionPriceId(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * Checkout sessions are tagged so flows can be compared in the Dashboard. The
 * suffix is random per the integration guidance.
 */
export function integrationIdentifier(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += letters[Math.floor(Math.random() * letters.length)];
  return `vantage-billing-${suffix}`;
}
