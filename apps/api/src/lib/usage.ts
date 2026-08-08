/**
 * Usage metering and quota enforcement.
 *
 * Counters live in `vantage.usage_counters`, keyed `(workspace_id, metric,
 * period_start)`. A new period simply produces a new row, so "reset at renewal"
 * needs no scheduled job and no destructive update — the old period's row stays
 * as history.
 *
 * The period boundary is the subscription's own anchor where one exists, so a
 * customer who subscribes on the 20th gets their allowance back on the 20th,
 * not on the 1st. Without a subscription (trial), it falls back to the calendar
 * month.
 *
 * Enforcement is a **hard block**: at quota the request is refused with 402 and
 * a pointer to the billing portal. No overage is billed, so there is no path to
 * a surprise invoice.
 */
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "./supabase.js";
import {
  effectivePlan,
  isExemptWorkspace,
  isUnlimited,
  limitFor,
  PLAN_BY_KEY,
  type Plan,
  type UsageMetric,
} from "./plans.js";

export type SubscriptionRow = {
  plan_key: string | null;
  status: string | null;
  current_period_end: string | null;
} | null;

/**
 * Start of the current billing period, as a date-only string.
 *
 * With a subscription we walk back from `current_period_end` by whole months
 * until we are at or before now — that lands on the renewal anchor without
 * needing to store the period start. Without one, the calendar month.
 */
export function periodStart(sub: SubscriptionRow, now: Date = new Date()): string {
  const end = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  if (!end || Number.isNaN(end.getTime())) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const start = new Date(end);
  // Guard the loop: a period end far in the future would otherwise spin.
  for (let i = 0; i < 240 && start > now; i++) {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  return start.toISOString().slice(0, 10);
}

/**
 * Raised when the billing schema cannot be read at all — a missing table, a
 * revoked grant, a dead connection.
 *
 * This exists because the alternative is worse than an outage. Swallowing the
 * error makes every read return null, which resolves every workspace to the
 * trial plan with usage permanently reading zero: metering looks like it is
 * working, the UI shows a tidy "0 / 10", and nothing is ever counted or
 * enforced. A paid product silently not billing is a failure you discover from
 * the bank statement. A 503 you discover in the first minute.
 */
export class BillingUnavailableError extends HTTPException {
  readonly detail: string;
  constructor(what: string, detail: string) {
    // 503, deliberately not 402: the caller has not hit a limit, the server
    // cannot tell whether they have. Conflating the two would show a customer
    // an upgrade prompt for our own broken deployment.
    super(503, {
      message: `Billing is temporarily unavailable (${what}). This is a server-side fault, not a quota limit.`,
    });
    this.name = "BillingUnavailableError";
    this.detail = detail;
    console.error(`[billing] ${what} failed: ${detail}`);
  }
}

/**
 * PostgREST reports a missing table/view as PGRST205, Postgres as 42P01. Both
 * mean the billing migration has not been applied — worth naming explicitly,
 * because it is by far the likeliest cause and the fix is not "retry".
 */
function describeError(err: { code?: string; message?: string } | null): string {
  const code = err?.code ?? "";
  if (code === "PGRST205" || code === "42P01") {
    return `${err?.message ?? "relation not found"} — the billing migration (20260808120000_billing.sql) is not applied`;
  }
  return err?.message ?? "unknown error";
}

/** Load the workspace's subscription row, or null when it has never subscribed. */
export async function loadSubscription(workspaceId: string): Promise<SubscriptionRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("billing_subscriptions")
    .select("plan_key, status, current_period_end")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  // maybeSingle() reports "no rows" as data:null with error:null, so a populated
  // error here is a real fault rather than a workspace that has not subscribed.
  if (error) throw new BillingUnavailableError("subscription lookup", describeError(error));
  return (data as SubscriptionRow) ?? null;
}

export type UsageSnapshot = {
  plan: Plan;
  period_start: string;
  used: Record<UsageMetric, number>;
  limits: Record<UsageMetric, number>;
};

export async function getUsage(workspaceId: string, sub?: SubscriptionRow): Promise<UsageSnapshot> {
  // Exempt workspaces skip the subscription lookup entirely — the operator
  // account has no Stripe customer and never should.
  if (isExemptWorkspace(workspaceId)) {
    const plan = PLAN_BY_KEY.internal;
    return {
      plan,
      period_start: periodStart(null),
      used: { generations: 0, videos: 0 },
      limits: { generations: plan.generations, videos: plan.videos },
    };
  }

  const subscription = sub === undefined ? await loadSubscription(workspaceId) : sub;
  const plan = effectivePlan(subscription);
  const period = periodStart(subscription);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("usage_counters")
    .select("metric, count")
    .eq("workspace_id", workspaceId)
    .eq("period_start", period);

  // An unreadable counter table would otherwise report 0 used against every
  // limit — quota that can never trip, presented as quota that is fine.
  if (error) throw new BillingUnavailableError("usage counters", describeError(error));

  const used: Record<UsageMetric, number> = { generations: 0, videos: 0 };
  for (const row of (data ?? []) as { metric: string; count: number }[]) {
    if (row.metric === "generations" || row.metric === "videos") {
      used[row.metric] = row.count ?? 0;
    }
  }

  return {
    plan,
    period_start: period,
    used,
    limits: { generations: plan.generations, videos: plan.videos },
  };
}

/**
 * Refuse the request when the workspace is at or over its allowance.
 *
 * Called *before* doing the work, so a rejected request costs nothing. 402
 * Payment Required is the honest status here — the request is well-formed and
 * authorized, it just needs a bigger plan.
 */
export async function assertQuota(workspaceId: string, metric: UsageMetric): Promise<UsageSnapshot> {
  // Cheapest possible path for the operator account: no database round trip at
  // all, so metering adds nothing to a request that can never be refused.
  if (isExemptWorkspace(workspaceId)) {
    const plan = PLAN_BY_KEY.internal;
    return {
      plan,
      period_start: periodStart(null),
      used: { generations: 0, videos: 0 },
      limits: { generations: plan.generations, videos: plan.videos },
    };
  }

  const snapshot = await getUsage(workspaceId);
  const limit = limitFor(snapshot.plan, metric);
  const used = snapshot.used[metric];

  if (isUnlimited(limit)) return snapshot;

  if (used >= limit) {
    const noun = metric === "generations" ? "posts" : "DemoForge videos";
    throw new HTTPException(402, {
      message:
        limit === 0
          ? `Your ${snapshot.plan.label} plan does not include ${noun}. Upgrade to continue.`
          : `Monthly ${noun} limit reached (${used}/${limit} on ${snapshot.plan.label}). Upgrade to continue.`,
    });
  }

  return snapshot;
}

/**
 * Increment a counter for the current period.
 *
 * Deliberately called *after* the work succeeds, so a failed generation does
 * not consume allowance. That direction of error is the right one: a customer
 * charged for a piece Kuze never produced would be a support ticket, while an
 * occasional uncounted retry is a rounding error against the quota.
 *
 * Fails soft — a metering write must never take down the pipeline it measures.
 */
export async function recordUsage(
  workspaceId: string,
  metric: UsageMetric,
  amount = 1,
  sub?: SubscriptionRow,
): Promise<void> {
  // Nothing to count for an exempt workspace, and no row to grow unbounded.
  if (isExemptWorkspace(workspaceId)) return;

  try {
    const subscription = sub === undefined ? await loadSubscription(workspaceId) : sub;
    const period = periodStart(subscription);
    const sb = getSupabaseAdmin();
    // Atomic increment; the RPC upserts the (workspace, metric, period) row.
    const { error } = await sb.rpc("increment_usage_counter", {
      p_workspace_id: workspaceId,
      p_metric: metric,
      p_period_start: period,
      p_amount: amount,
    });
    if (error) throw new Error(describeError(error));
  } catch (err) {
    // Deliberately still fail-soft: this runs *after* the work succeeded, and
    // refusing a piece the customer already has would be worse than an
    // uncounted one. But it is logged at error level, not warn — an
    // undercounted meter is revenue quietly leaking, not a curiosity.
    console.error(
      `[billing] failed to record ${metric} for workspace ${workspaceId} — usage is undercounted:`,
      err instanceof Error ? err.message : err,
    );
  }
}
