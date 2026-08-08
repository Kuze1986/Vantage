import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  integrationIdentifier,
  invoiceSubscriptionId,
  isStripeConfigured,
  planFromPriceId,
  PRICE_ENV,
  resolvePriceId,
  subscriptionPeriodEnd,
  subscriptionPriceId,
} from "./stripe.js";

const SAVED = { ...process.env };

beforeEach(() => {
  for (const name of Object.values(PRICE_ENV)) delete process.env[name];
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("stripe / catalogue mapping", () => {
  it("resolves a configured price id", () => {
    process.env.STRIPE_PRICE_GROWTH_MONTHLY = "price_growth_m";
    expect(resolvePriceId("growth", "monthly")).toBe("price_growth_m");
  });

  it("names the missing variable rather than failing vaguely", () => {
    expect(() => resolvePriceId("scale", "annual")).toThrow(/STRIPE_PRICE_SCALE_ANNUAL/);
  });

  it("maps both intervals of a tier to the same plan", () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_a";
    process.env.STRIPE_PRICE_STARTER_ANNUAL = "price_b";
    expect(planFromPriceId("price_a")).toBe("starter");
    expect(planFromPriceId("price_b")).toBe("starter");
  });

  it("returns null for an unknown or absent price", () => {
    expect(planFromPriceId("price_unknown")).toBeNull();
    expect(planFromPriceId(null)).toBeNull();
    expect(planFromPriceId(undefined)).toBeNull();
  });

  it("picks up a price id added to the environment without a restart", () => {
    expect(planFromPriceId("price_late")).toBeNull();
    process.env.STRIPE_PRICE_SCALE_MONTHLY = "price_late";
    expect(planFromPriceId("price_late")).toBe("scale");
  });

  it("reports whether billing is configured at all", () => {
    expect(isStripeConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(isStripeConfigured()).toBe(true);
  });
});

describe("stripe / 2026 API field moves", () => {
  it("reads the period end from the subscription item when the top level is gone", () => {
    // Stripe moved period timestamps onto items. Reading the old field yields
    // undefined after a version bump, which writes a null period end and makes
    // every subscription look expired - silently.
    const sub = { items: { data: [{ current_period_end: 1_800_000_000 }] } } as never;
    expect(subscriptionPeriodEnd(sub)?.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("still accepts the legacy top-level period end", () => {
    const sub = { current_period_end: 1_700_000_000, items: { data: [] } } as never;
    expect(subscriptionPeriodEnd(sub)?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it("returns null when neither shape carries a timestamp", () => {
    expect(subscriptionPeriodEnd({ items: { data: [{}] } } as never)).toBeNull();
  });

  it("reads the invoice's subscription from either the old or new location", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_legacy" } as never)).toBe("sub_legacy");
    expect(invoiceSubscriptionId({ subscription: { id: "sub_obj" } } as never)).toBe("sub_obj");
    expect(
      invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } } as never),
    ).toBe("sub_new");
    expect(invoiceSubscriptionId({} as never)).toBeNull();
  });

  it("reads the bought tier from the first subscription item", () => {
    expect(subscriptionPriceId({ items: { data: [{ price: { id: "price_x" } }] } } as never)).toBe("price_x");
    expect(subscriptionPriceId({ items: { data: [] } } as never)).toBeNull();
  });
});

describe("stripe / integration identifier", () => {
  it("carries an 8-letter random suffix and varies per call", () => {
    const a = integrationIdentifier();
    expect(a).toMatch(/^vantage-billing-[a-z]{8}$/);
    const many = new Set(Array.from({ length: 20 }, () => integrationIdentifier()));
    expect(many.size).toBeGreaterThan(1);
  });
});
