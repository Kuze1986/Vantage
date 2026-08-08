/**
 * Plan catalogue — the single source of truth for tiers, quotas and limits.
 *
 * Everything that needs to know about plans reads from here: the billing route,
 * quota enforcement, the Settings panel, and the Stripe webhook's price-id →
 * plan mapping. Keeping one table is what stops the marketing page, the
 * enforcement check and the webhook drifting into three different answers.
 *
 * Prices follow the pricing working paper (2026-08-08). Annual is ten months'
 * price — "two months free".
 *
 * **Quota is metered on generation, not publication.** The rate card says
 * "posts / mo" because that is what a customer perceives, but the counter
 * decrements when Kuze generates a piece. Cost is incurred at generation
 * (~$0.01–0.02 text, $0.04–0.08 with an image) and Vantage's pipeline
 * structurally generates more than it publishes: auto-generate fills a deficit
 * and Ilita rejects a share. Metering publishes would let a workspace generate
 * hundreds of pieces, publish sixty, and pay for sixty.
 */

export type PlanKey = "trial" | "starter" | "growth" | "scale" | "internal";

/** Sentinel for "no ceiling". JSON has no Infinity, so -1 carries it over the wire. */
export const UNLIMITED = -1;

export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

export interface Plan {
  key: PlanKey;
  label: string;
  /** Display price, monthly billing. */
  priceMonthly: string;
  /** Display price, annual billing (ten months — two free). */
  priceAnnual: string | null;
  /** Kuze generations per billing period. The customer-facing "posts / mo". */
  generations: number;
  /** DemoForge renders per billing period. */
  videos: number;
  /** Workspaces included. */
  workspaces: number;
  /** Distribution channels connectable. 9 = all. */
  channels: number;
  features: string[];
  /** Whether self-service checkout exists for this tier. */
  selfServe: boolean;
}

export const PLANS: Plan[] = [
  {
    /**
     * Operator/owner account. Never sold, never shown on the rate card, and not
     * reachable through checkout — granted only by listing a workspace id in
     * BILLING_EXEMPT_WORKSPACES, which is server-side env. A workspace cannot
     * put itself here.
     *
     * Genuinely uncapped, unlike the paid tiers: this is the account that runs
     * the product, and metering it would only ever get in the way.
     */
    key: "internal",
    label: "Internal",
    priceMonthly: "—",
    priceAnnual: null,
    generations: UNLIMITED,
    videos: UNLIMITED,
    workspaces: UNLIMITED,
    channels: 9,
    features: ["Unlimited everything", "Not billed", "Operator account"],
    selfServe: false,
  },
  {
    // The state before any subscription exists. Not on the rate card — it is
    // what a workspace gets the moment it is provisioned, so the pipeline is
    // explorable without a card. Small enough to bound the cost of an abandoned
    // signup (10 generations ≈ $0.20, no video at $0.50–1.50 a render).
    key: "trial",
    label: "Trial",
    priceMonthly: "$0",
    priceAnnual: null,
    generations: 10,
    videos: 0,
    workspaces: 1,
    channels: 3,
    features: ["10 posts to try the pipeline", "Brand Voice + Ilita audit", "No card required"],
    selfServe: false,
  },
  {
    key: "starter",
    label: "Starter",
    priceMonthly: "$39",
    priceAnnual: "$390",
    generations: 60,
    videos: 0,
    workspaces: 1,
    channels: 3,
    features: [
      "1 workspace, up to 3 channels",
      "60 posts / mo",
      "Images included",
      "No DemoForge video",
      "Brand Voice + Ilita audit",
    ],
    selfServe: true,
  },
  {
    key: "growth",
    label: "Growth",
    priceMonthly: "$129",
    priceAnnual: "$1,290",
    generations: 300,
    videos: 10,
    workspaces: 1,
    channels: 9,
    features: [
      "1 workspace, all 9 channels",
      "300 posts / mo",
      "Images included",
      "10 DemoForge videos / mo",
      "BioLoop learning + Campaign Builder",
    ],
    selfServe: true,
  },
  {
    key: "scale",
    label: "Scale",
    priceMonthly: "$349",
    priceAnnual: "$3,490",
    generations: 1200,
    videos: 40,
    workspaces: 3,
    channels: 9,
    features: [
      "3 workspaces included",
      "1,200 posts / mo pooled",
      "Images included",
      "40 DemoForge videos / mo",
      "Strategic Intelligence + competitor monitoring",
    ],
    selfServe: true,
  },
];

export const PLAN_BY_KEY: Record<PlanKey, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.key, p]),
) as Record<PlanKey, Plan>;

/** Unknown or absent plan resolves to trial — never to a paid tier's quota. */
export function planFor(key: string | null | undefined): Plan {
  return PLAN_BY_KEY[(key ?? "trial") as PlanKey] ?? PLAN_BY_KEY.trial;
}

/** Tiers offered on the rate card — excludes trial and internal. */
export const SELLABLE_PLANS: Plan[] = PLANS.filter((p) => p.selfServe);

/**
 * Workspaces exempt from metering entirely, from `BILLING_EXEMPT_WORKSPACES`
 * (comma-separated workspace ids).
 *
 * Server-side env deliberately, not a database column or a setting: anything
 * reachable through the API could be self-granted by the workspace it exempts.
 * Read per call so the list can change without a restart.
 */
export function exemptWorkspaceIds(): Set<string> {
  const raw = process.env.BILLING_EXEMPT_WORKSPACES ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export function isExemptWorkspace(workspaceId: string): boolean {
  return exemptWorkspaceIds().has(workspaceId);
}

/** The metered dimensions. Keep in step with `Plan` and `usage_counters.metric`. */
export type UsageMetric = "generations" | "videos";

export const USAGE_METRICS: UsageMetric[] = ["generations", "videos"];

/** The plan's allowance for a metric. */
export function limitFor(plan: Plan, metric: UsageMetric): number {
  return metric === "generations" ? plan.generations : plan.videos;
}

/**
 * Which Stripe subscription statuses entitle a workspace to its paid plan.
 *
 * `past_due` is deliberately included: a failed payment starts a dunning
 * retry cycle, and cutting a customer off mid-cycle for a card that Stripe is
 * still retrying is hostile and usually wrong. `unpaid` and `canceled` are
 * where entitlement actually ends.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isEntitled(status: string | null | undefined): boolean {
  return typeof status === "string" && ENTITLING_STATUSES.has(status);
}

/** Resolve the effective plan from a stored subscription row. */
export function effectivePlan(sub: { plan_key?: string | null; status?: string | null } | null): Plan {
  if (!sub || !isEntitled(sub.status)) return PLAN_BY_KEY.trial;
  return planFor(sub.plan_key);
}
