import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  campaign: null as { id: string; name: string; messaging_pillars: unknown } | null,
  kpiRows: [] as Array<{ impressions: number; engagements: number }>,
  posts: [] as unknown[],
  trends: [] as unknown[],
  insertedInsights: [] as Array<Record<string, unknown>>,
  generateInsights: vi.fn(async () => ({ insights: [] as any[] })),
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "campaigns") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.campaign, error: null }) }) }) }) };
      }
      if (table === "campaign_kpi_tracking") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: h.kpiRows, error: null }) }) }) };
      }
      if (table === "competitive_posts") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: h.posts, error: null }) }) }) }) };
      }
      if (table === "trending_content") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: h.trends, error: null }) }) }) }) };
      }
      if (table === "intelligence_insights") {
        return { insert: (rows: Record<string, unknown>[]) => { h.insertedInsights.push(...rows); return Promise.resolve({ error: null }); } };
      }
      return { select: () => ({ eq: () => ({}) }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/intelligence.js", () => ({ generateInsights: h.generateInsights }));

import { generateAndStoreInsights } from "./insights-generator.js";

beforeEach(() => {
  h.campaign = null;
  h.kpiRows = [];
  h.posts = [];
  h.trends = [];
  h.insertedInsights.length = 0;
  h.generateInsights.mockClear();
  h.generateInsights.mockResolvedValue({ insights: [] });
});

describe("generateAndStoreInsights", () => {
  it("skips when the campaign doesn't exist", async () => {
    h.campaign = null;
    const result = await generateAndStoreInsights("ws-1", "camp-1");
    expect(result).toMatchObject({ inserted: 0, skipped: "campaign not found" });
    expect(h.generateInsights).not.toHaveBeenCalled();
  });

  it("skips campaigns with too little impression data rather than generating noise", async () => {
    h.campaign = { id: "camp-1", name: "Launch", messaging_pillars: [] };
    h.kpiRows = [{ impressions: 40, engagements: 5 }];
    const result = await generateAndStoreInsights("ws-1", "camp-1");
    expect(result.inserted).toBe(0);
    expect(result.skipped).toMatch(/insufficient data/);
    expect(h.generateInsights).not.toHaveBeenCalled();
  });

  it("calls generateInsights with aggregated performance once the impression floor is met, and inserts results", async () => {
    h.campaign = { id: "camp-1", name: "Launch", messaging_pillars: [{ id: "p1", name: "Educate", description: "Teach the basics" }] };
    h.kpiRows = [{ impressions: 300, engagements: 30 }, { impressions: 200, engagements: 20 }];
    h.generateInsights.mockResolvedValue({
      insights: [
        { insight_type: "opportunity", title: "Try threads", description: "desc", confidence_score: 70, recommended_actions: [], expected_impact: {} },
      ],
    });

    const result = await generateAndStoreInsights("ws-1", "camp-1");
    expect(h.generateInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignName: "Launch",
        currentPerformance: { impressions: 500, engagements: 50, engagementRate: 0.1 },
        messagingPillars: [{ name: "Educate", description: "Teach the basics" }],
      }),
    );
    expect(result.inserted).toBe(1);
    expect(h.insertedInsights[0]).toMatchObject({ workspace_id: "ws-1", campaign_id: "camp-1", title: "Try threads", generated_by: "claude" });
  });

  it("does not throw when generateInsights itself fails", async () => {
    h.campaign = { id: "camp-1", name: "Launch", messaging_pillars: [] };
    h.kpiRows = [{ impressions: 500, engagements: 50 }];
    h.generateInsights.mockRejectedValue(new Error("LLM timeout"));

    const result = await generateAndStoreInsights("ws-1", "camp-1");
    expect(result).toMatchObject({ inserted: 0, skipped: "generation failed" });
  });
});
