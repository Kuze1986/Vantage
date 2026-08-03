import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => ({
  sources: [] as Array<{ id: string; source_type: string; source_platform: string; source_identifier: string }>,
  existingPostIds: new Set<string>(),
  inserts: [] as Array<Record<string, unknown>>,
  fetchImpl: null as ((url: string) => Promise<{ id: string; title: string; ups: number; num_comments: number; author: string; created_utc: number; permalink: string; selftext?: string }[]>) | null,
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "monitoring_sources") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: h.sources, error: null }) }) }) };
      }
      if (table === "competitive_posts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: (_col: string, postId: string) => ({
                  maybeSingle: async () => ({ data: h.existingPostIds.has(postId) ? { id: "existing" } : null, error: null }),
                }),
              }),
            }),
          }),
          insert: (p: Record<string, unknown>) => { h.inserts.push(p); return Promise.resolve({ error: null }); },
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/intelligence.js", () => ({
  analyzeCompetitivePost: vi.fn(async () => ({
    themes: ["thought_leadership"],
    sentiment: "positive" as const,
    engagement_potential: 0.42,
    virality_indicators: { engagement_rate: 0.1, repost_rate: 0.02, trend_velocity: 0.3 },
  })),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  h.sources = [];
  h.existingPostIds = new Set();
  h.inserts.length = 0;
  global.fetch = vi.fn(async (url: string | URL) => {
    const posts = h.fetchImpl ? await h.fetchImpl(url.toString()) : [];
    return {
      ok: true,
      json: async () => ({ data: { children: posts.map((p) => ({ data: p })) } }),
    } as Response;
  }) as typeof fetch;
});

import { collectCompetitivePosts } from "./competitive-collector.js";

function redditPost(overrides: Partial<{ id: string; title: string; ups: number; num_comments: number; author: string; permalink: string }> = {}) {
  return {
    id: "abc123",
    title: "A great post",
    ups: 100,
    num_comments: 10,
    author: "some_user",
    created_utc: 1_700_000_000,
    permalink: "/r/test/comments/abc123/a_great_post",
    ...overrides,
  };
}

describe("collectCompetitivePosts", () => {
  it("returns zero scanned/inserted when there are no active sources", async () => {
    h.sources = [];
    const result = await collectCompetitivePosts("ws-1");
    expect(result).toEqual({ scanned: 0, inserted: 0 });
    expect(h.inserts).toHaveLength(0);
  });

  it("skips x/linkedin sources entirely and only collects from reddit", async () => {
    h.sources = [
      { id: "s1", source_type: "competitor", source_platform: "x", source_identifier: "rival_co" },
      { id: "s2", source_type: "competitor", source_platform: "linkedin", source_identifier: "rival-co" },
      { id: "s3", source_type: "competitor", source_platform: "reddit", source_identifier: "rival_user" },
    ];
    h.fetchImpl = async () => [redditPost()];
    const result = await collectCompetitivePosts("ws-1");
    expect(result.inserted).toBe(1);
    expect(h.inserts[0]).toMatchObject({ source_platform: "reddit", source_account_name: "some_user" });
  });

  it("dedupes against existing competitive_posts by post_id", async () => {
    h.sources = [{ id: "s1", source_type: "keyword", source_platform: "reddit", source_identifier: "certification" }];
    h.existingPostIds.add("abc123");
    h.fetchImpl = async () => [redditPost({ id: "abc123" })];
    const result = await collectCompetitivePosts("ws-1");
    expect(result.inserted).toBe(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("inserts new posts with engagement fields derived from ups/num_comments and impressions=0", async () => {
    h.sources = [{ id: "s1", source_type: "keyword", source_platform: "reddit", source_identifier: "certification" }];
    h.fetchImpl = async () => [redditPost({ id: "new1", ups: 250, num_comments: 40 })];
    await collectCompetitivePosts("ws-1");
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      post_id: "new1",
      impressions: 0,
      engagements: 290,
      likes: 250,
      replies: 40,
      reposts: 0,
      sentiment: "positive",
      relevance_score: "0.42",
    });
  });

  it("analyzes the highest-engagement posts first when multiple are found", async () => {
    h.sources = [{ id: "s1", source_type: "keyword", source_platform: "reddit", source_identifier: "certification" }];
    h.fetchImpl = async () => [
      redditPost({ id: "low", ups: 5, num_comments: 1 }),
      redditPost({ id: "high", ups: 500, num_comments: 100 }),
    ];
    await collectCompetitivePosts("ws-1");
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[0].post_id).toBe("high");
    expect(h.inserts[1].post_id).toBe("low");
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});
