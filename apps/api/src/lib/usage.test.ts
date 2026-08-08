import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();
const selectEqMock = vi.fn();

vi.mock("./supabase.js", () => ({
  getSupabaseAdmin: () => ({
    rpc: rpcMock,
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, _v: string) => ({
          maybeSingle: maybeSingleMock,
          eq: () => selectEqMock(table),
        }),
      }),
    }),
  }),
}));

const { assertQuota, getUsage, periodStart, recordUsage } = await import("./usage.js");

const ORIGINAL = process.env.BILLING_EXEMPT_WORKSPACES;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BILLING_EXEMPT_WORKSPACES;
  rpcMock.mockResolvedValue({ error: null });
  maybeSingleMock.mockResolvedValue({ data: null });
  selectEqMock.mockResolvedValue({ data: [] });
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BILLING_EXEMPT_WORKSPACES;
  else process.env.BILLING_EXEMPT_WORKSPACES = ORIGINAL;
});

describe("usage / periodStart", () => {
  it("falls back to the calendar month with no subscription", () => {
    expect(periodStart(null, new Date("2026-08-14T10:00:00Z"))).toBe("2026-08-01");
  });

  it("anchors to the subscription's renewal day, not the 1st", () => {
    // Subscribed on the 20th: the allowance resets on the 20th.
    const sub = { plan_key: "growth", status: "active", current_period_end: "2026-09-20T00:00:00Z" };
    expect(periodStart(sub, new Date("2026-09-01T00:00:00Z"))).toBe("2026-08-20");
  });

  it("walks back multiple months for a far-future period end without spinning", () => {
    const sub = { plan_key: "scale", status: "active", current_period_end: "2027-01-15T00:00:00Z" };
    expect(periodStart(sub, new Date("2026-08-08T00:00:00Z"))).toBe("2026-07-15");
  });

  it("ignores an unparseable period end", () => {
    const sub = { plan_key: "growth", status: "active", current_period_end: "not-a-date" };
    expect(periodStart(sub, new Date("2026-08-14T00:00:00Z"))).toBe("2026-08-01");
  });
});

describe("usage / quota enforcement", () => {
  it("refuses with 402 once the allowance is spent", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { plan_key: "starter", status: "active", current_period_end: "2026-09-01T00:00:00Z" },
    });
    selectEqMock.mockResolvedValue({ data: [{ metric: "generations", count: 60 }] });

    await expect(assertQuota("ws-1", "generations")).rejects.toMatchObject({ status: 402 });
  });

  it("allows the request that sits exactly one under the limit", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { plan_key: "starter", status: "active", current_period_end: "2026-09-01T00:00:00Z" },
    });
    selectEqMock.mockResolvedValue({ data: [{ metric: "generations", count: 59 }] });

    await expect(assertQuota("ws-1", "generations")).resolves.toMatchObject({ plan: { key: "starter" } });
  });

  it("explains a zero allowance differently from an exhausted one", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { plan_key: "starter", status: "active", current_period_end: "2026-09-01T00:00:00Z" },
    });
    selectEqMock.mockResolvedValue({ data: [] });

    // Starter includes no video at all — "limit reached (0/0)" would be baffling.
    await expect(assertQuota("ws-1", "videos")).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining("does not include"),
    });
  });

  it("drops a canceled subscription to trial quota", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { plan_key: "scale", status: "canceled", current_period_end: "2026-09-01T00:00:00Z" },
    });
    selectEqMock.mockResolvedValue({ data: [{ metric: "generations", count: 10 }] });

    await expect(assertQuota("ws-1", "generations")).rejects.toMatchObject({ status: 402 });
  });
});

describe("usage / operator exemption", () => {
  beforeEach(() => {
    process.env.BILLING_EXEMPT_WORKSPACES = "ws-owner";
  });

  it("never refuses an exempt workspace, at any usage", async () => {
    selectEqMock.mockResolvedValue({ data: [{ metric: "generations", count: 999_999 }] });
    await expect(assertQuota("ws-owner", "generations")).resolves.toMatchObject({
      plan: { key: "internal" },
    });
    await expect(assertQuota("ws-owner", "videos")).resolves.toMatchObject({ plan: { key: "internal" } });
  });

  it("does not touch the database for an exempt workspace", async () => {
    await assertQuota("ws-owner", "generations");
    expect(maybeSingleMock).not.toHaveBeenCalled();
    expect(selectEqMock).not.toHaveBeenCalled();
  });

  it("records no usage for an exempt workspace", async () => {
    await recordUsage("ws-owner", "generations");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reports the internal plan with uncapped limits", async () => {
    const snap = await getUsage("ws-owner");
    expect(snap.limits.generations).toBeLessThan(0);
    expect(snap.limits.videos).toBeLessThan(0);
  });

  it("still meters everyone else", async () => {
    await recordUsage("ws-other", "generations");
    expect(rpcMock).toHaveBeenCalledWith(
      "increment_usage_counter",
      expect.objectContaining({ p_workspace_id: "ws-other", p_metric: "generations", p_amount: 1 }),
    );
  });
});

describe("usage / recording", () => {
  it("fails soft — metering must not take down the pipeline it measures", async () => {
    rpcMock.mockResolvedValue({ error: { message: "connection reset" } });
    await expect(recordUsage("ws-1", "generations")).resolves.toBeUndefined();
  });
});
