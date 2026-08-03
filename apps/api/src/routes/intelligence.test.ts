import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insight: null as { id: string; title: string; description: string } | null,
  campaign: null as { id: string; start_date: string } | null,
  existingTimeline: [] as Array<{ day_number: number; date_scheduled: string }>,
  timelineInserts: [] as Array<Record<string, unknown>>,
  insightUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "intelligence_insights") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: h.insight, error: null }),
              }),
            }),
          }),
          update: (p: Record<string, unknown>) => ({
            eq: () => { h.insightUpdates.push(p); return Promise.resolve({ error: null }); },
          }),
        };
      }
      if (table === "campaigns") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: h.campaign, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "campaign_timeline") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: h.existingTimeline, error: null }),
              }),
            }),
          }),
          insert: (p: Record<string, unknown>) => {
            h.timelineInserts.push(p);
            return {
              select: () => ({
                single: async () => ({ data: { id: "day-1", ...p }, error: null }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({}) }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/intelligence.js", () => ({
  analyzeCompetitivePost: vi.fn(),
  detectTrends: vi.fn(),
  generateInsights: vi.fn(),
  generateBenchmarkAnalysis: vi.fn(),
}));

import { intelligenceRoutes } from "./intelligence.js";

function applyInsight(id: string, body: unknown, workspaceId?: string) {
  return intelligenceRoutes.request(`/insights/${id}/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.insight = null;
  h.campaign = null;
  h.existingTimeline = [];
  h.timelineInserts.length = 0;
  h.insightUpdates.length = 0;
});

describe("POST /insights/:id/apply", () => {
  it("requires x-workspace-id", async () => {
    const res = await applyInsight("insight-1", { campaign_id: "camp-1" });
    expect(res.status).toBe(400);
  });

  it("requires campaign_id in the body", async () => {
    const res = await applyInsight("insight-1", {}, "ws-1");
    expect(res.status).toBe(400);
  });

  it("404s when the insight doesn't exist in this workspace", async () => {
    h.insight = null;
    const res = await applyInsight("insight-1", { campaign_id: "camp-1" }, "ws-1");
    expect(res.status).toBe(404);
  });

  it("404s when the campaign doesn't exist in this workspace", async () => {
    h.insight = { id: "insight-1", title: "Lean into how-to content", description: "Competitors are winning with tutorials." };
    h.campaign = null;
    const res = await applyInsight("insight-1", { campaign_id: "camp-1" }, "ws-1");
    expect(res.status).toBe(404);
  });

  it("appends day 0 with visual_type=social_graphic when the timeline is empty", async () => {
    h.insight = { id: "insight-1", title: "Lean into how-to content", description: "Competitors are winning with tutorials." };
    h.campaign = { id: "camp-1", start_date: "2026-08-01" };
    h.existingTimeline = [];

    const res = await applyInsight("insight-1", { campaign_id: "camp-1" }, "ws-1");
    expect(res.status).toBe(201);
    expect(h.timelineInserts).toHaveLength(1);
    const row = h.timelineInserts[0];
    expect(row.day_number).toBe(0);
    expect(row.date_scheduled).toBe("2026-08-01");
    expect(row.primary_channel).toBe("x");
    expect((row.content_ideas as any[])[0]).toMatchObject({
      title: "Lean into how-to content",
      outline: "Competitors are winning with tutorials.",
      visual_type: "social_graphic",
    });
    expect(h.insightUpdates).toHaveLength(1);
    expect(h.insightUpdates[0]).toMatchObject({ status: "actioned" });
  });

  it("appends after the last existing day, incrementing day_number and date", async () => {
    h.insight = { id: "insight-1", title: "Post more threads", description: "Thread format outperforms single posts." };
    h.campaign = { id: "camp-1", start_date: "2026-08-01" };
    h.existingTimeline = [{ day_number: 3, date_scheduled: "2026-08-04" }];

    await applyInsight("insight-1", { campaign_id: "camp-1" }, "ws-1");
    const row = h.timelineInserts[0];
    expect(row.day_number).toBe(4);
    expect(row.date_scheduled).toBe("2026-08-05");
  });
});
