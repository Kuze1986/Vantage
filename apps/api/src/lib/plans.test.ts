import { afterEach, describe, expect, it } from "vitest";
import {
  effectivePlan,
  isEntitled,
  isExemptWorkspace,
  isUnlimited,
  limitFor,
  PLAN_BY_KEY,
  PLANS,
  planFor,
  SELLABLE_PLANS,
  UNLIMITED,
} from "./plans.js";

const ORIGINAL = process.env.BILLING_EXEMPT_WORKSPACES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BILLING_EXEMPT_WORKSPACES;
  else process.env.BILLING_EXEMPT_WORKSPACES = ORIGINAL;
});

describe("plans / catalogue", () => {
  it("matches the rate card", () => {
    expect(PLAN_BY_KEY.starter).toMatchObject({ priceMonthly: "$39", generations: 60, videos: 0, channels: 3 });
    expect(PLAN_BY_KEY.growth).toMatchObject({ priceMonthly: "$129", generations: 300, videos: 10, channels: 9 });
    expect(PLAN_BY_KEY.scale).toMatchObject({ priceMonthly: "$349", generations: 1200, videos: 40, workspaces: 3 });
  });

  it("prices annual at ten months — two free", () => {
    expect(PLAN_BY_KEY.starter.priceAnnual).toBe("$390");
    expect(PLAN_BY_KEY.growth.priceAnnual).toBe("$1,290");
    expect(PLAN_BY_KEY.scale.priceAnnual).toBe("$3,490");
  });

  it("sells only the three rate-card tiers", () => {
    expect(SELLABLE_PLANS.map((p) => p.key)).toEqual(["starter", "growth", "scale"]);
    // Neither the free trial nor the operator account can be bought.
    expect(PLAN_BY_KEY.trial.selfServe).toBe(false);
    expect(PLAN_BY_KEY.internal.selfServe).toBe(false);
  });

  it("falls back to trial for an unknown or missing plan, never a paid tier", () => {
    for (const key of [null, undefined, "", "enterprise", "pro"]) {
      expect(planFor(key).key).toBe("trial");
    }
  });

  it("starter includes no video allowance", () => {
    expect(limitFor(PLAN_BY_KEY.starter, "videos")).toBe(0);
    expect(limitFor(PLAN_BY_KEY.growth, "videos")).toBe(10);
  });
});

describe("plans / entitlement", () => {
  it("keeps a past_due subscription entitled while Stripe retries", () => {
    // Cutting a customer off mid-dunning for a card Stripe is still retrying
    // is hostile and usually wrong.
    expect(isEntitled("past_due")).toBe(true);
    expect(isEntitled("active")).toBe(true);
    expect(isEntitled("trialing")).toBe(true);
  });

  it("ends entitlement at canceled, unpaid, or no subscription", () => {
    for (const s of ["canceled", "unpaid", "incomplete_expired", null, undefined, ""]) {
      expect(isEntitled(s), String(s)).toBe(false);
    }
  });

  it("drops an unentitled subscription back to trial quota", () => {
    expect(effectivePlan({ plan_key: "scale", status: "canceled" }).key).toBe("trial");
    expect(effectivePlan({ plan_key: "scale", status: "active" }).key).toBe("scale");
    expect(effectivePlan(null).key).toBe("trial");
  });
});

describe("plans / operator exemption", () => {
  it("is granted only through server-side env", () => {
    process.env.BILLING_EXEMPT_WORKSPACES = "ws-1,ws-2";
    expect(isExemptWorkspace("ws-1")).toBe(true);
    expect(isExemptWorkspace("ws-2")).toBe(true);
    expect(isExemptWorkspace("ws-3")).toBe(false);
  });

  it("tolerates whitespace and empty entries", () => {
    process.env.BILLING_EXEMPT_WORKSPACES = " ws-1 , , ws-2 ,";
    expect(isExemptWorkspace("ws-1")).toBe(true);
    expect(isExemptWorkspace("ws-2")).toBe(true);
    expect(isExemptWorkspace("")).toBe(false);
  });

  it("exempts nobody when unset", () => {
    delete process.env.BILLING_EXEMPT_WORKSPACES;
    expect(isExemptWorkspace("ws-1")).toBe(false);
  });

  it("gives the internal plan uncapped limits", () => {
    expect(isUnlimited(PLAN_BY_KEY.internal.generations)).toBe(true);
    expect(isUnlimited(PLAN_BY_KEY.internal.videos)).toBe(true);
    expect(PLAN_BY_KEY.internal.generations).toBe(UNLIMITED);
    // Paid tiers are finite — "unlimited" on a sold plan is an uncapped liability.
    for (const p of SELLABLE_PLANS) {
      expect(isUnlimited(p.generations), p.key).toBe(false);
    }
  });

  it("every plan key round-trips through planFor", () => {
    for (const p of PLANS) expect(planFor(p.key).key).toBe(p.key);
  });
});
