import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  segments: [] as Array<{ id: string; name: string }>,
  members: [] as Array<{ external_id: string; segment_id: string }>,
  events: [] as Array<{ content_piece_id: string | null; actor_external_id: string | null }>,
  pieces: [] as Array<{ id: string; channel_slug: string; content_payload: unknown; published_at: string | null; image_url: string | null; video_url: string | null }>,
  existingPrefs: null as { id: string } | null,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  learnSegmentPreferences: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "segments") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: h.segments, error: null }) }) }) };
      }
      if (table === "segment_members") {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: h.members, error: null }) }) }) };
      }
      if (table === "engagement_events") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                gte: () => ({
                  not: async () => ({ data: h.events, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "content_pieces") {
        return { select: () => ({ in: async () => ({ data: h.pieces, error: null }) }) };
      }
      if (table === "segment_preferences") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.existingPrefs, error: null }) }) }),
          insert: (p: Record<string, unknown>) => { h.inserts.push(p); return Promise.resolve({ error: null }); },
          update: (p: Record<string, unknown>) => ({
            eq: () => { h.updates.push(p); return Promise.resolve({ error: null }); },
          }),
        };
      }
      return { select: () => ({ eq: () => ({}) }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/audience.js", () => ({ learnSegmentPreferences: h.learnSegmentPreferences }));

import { learnAndStorePreferences } from "./segment-preferences-learner.js";

beforeEach(() => {
  h.segments = [];
  h.members = [];
  h.events = [];
  h.pieces = [];
  h.existingPrefs = null;
  h.inserts.length = 0;
  h.updates.length = 0;
  h.learnSegmentPreferences.mockReset();
  h.learnSegmentPreferences.mockResolvedValue({
    preferred_content_types: ["educational"],
    preferred_tones: ["professional"],
    preferred_formats: ["short_text"],
    optimal_posting_times: { best_days: ["tuesday"], best_hours: [10] },
    topic_interests: {},
    preferred_cta_types: ["link"],
    post_length_preference: "short",
  });
});

function piece(id: string, overrides: Partial<{ channel_slug: string; content_payload: unknown; image_url: string | null; video_url: string | null }> = {}) {
  return {
    id,
    channel_slug: "x",
    content_payload: { body: "Learn how to pass your exam faster. Sign up today!" },
    published_at: "2026-07-01T00:00:00Z",
    image_url: null,
    video_url: null,
    ...overrides,
  };
}

describe("learnAndStorePreferences", () => {
  it("does nothing when there are no active segments", async () => {
    h.segments = [];
    const result = await learnAndStorePreferences("ws-1");
    expect(result).toEqual({ segmentsProcessed: 0, updated: 0 });
  });

  it("skips a segment below the minimum member floor", async () => {
    h.segments = [{ id: "seg-1", name: "Engaged Redditors" }];
    h.members = [{ external_id: "u1", segment_id: "seg-1" }, { external_id: "u2", segment_id: "seg-1" }]; // 2 < MIN_MEMBERS(3)
    const result = await learnAndStorePreferences("ws-1");
    expect(result.updated).toBe(0);
    expect(h.learnSegmentPreferences).not.toHaveBeenCalled();
  });

  it("skips a segment whose members engaged with too few distinct posts", async () => {
    h.segments = [{ id: "seg-1", name: "Engaged Redditors" }];
    h.members = [
      { external_id: "u1", segment_id: "seg-1" },
      { external_id: "u2", segment_id: "seg-1" },
      { external_id: "u3", segment_id: "seg-1" },
    ];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "u1" }]; // only 1 distinct post < MIN_ENGAGED_POSTS(3)
    const result = await learnAndStorePreferences("ws-1");
    expect(result.updated).toBe(0);
    expect(h.learnSegmentPreferences).not.toHaveBeenCalled();
  });

  it("learns and inserts new preferences with real-data-derived length/visual/hashtag fields", async () => {
    h.segments = [{ id: "seg-1", name: "Engaged Redditors" }];
    h.members = [
      { external_id: "u1", segment_id: "seg-1" },
      { external_id: "u2", segment_id: "seg-1" },
      { external_id: "u3", segment_id: "seg-1" },
    ];
    h.events = [
      { content_piece_id: "piece-1", actor_external_id: "u1" },
      { content_piece_id: "piece-2", actor_external_id: "u2" },
      { content_piece_id: "piece-3", actor_external_id: "u3" },
    ];
    h.pieces = [
      piece("piece-1", { image_url: "https://x/img.png" }),
      piece("piece-2"),
      piece("piece-3", { content_payload: { body: "No hooks here" } }),
    ];

    const result = await learnAndStorePreferences("ws-1");
    expect(result.updated).toBe(1);
    expect(h.learnSegmentPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ segmentName: "Engaged Redditors" }),
    );
    expect(h.inserts).toHaveLength(1);
    const row = h.inserts[0];
    expect(row.segment_id).toBe("seg-1");
    expect(row.preferred_content_types).toEqual(["educational"]);
    expect(row.avg_preferred_post_length).toBeGreaterThan(0);
    expect(typeof row.prefers_visuals).toBe("boolean");
    expect(typeof row.prefers_hashtags).toBe("boolean");
  });

  it("updates an existing segment_preferences row instead of inserting a duplicate", async () => {
    h.segments = [{ id: "seg-1", name: "Engaged Redditors" }];
    h.members = [
      { external_id: "u1", segment_id: "seg-1" },
      { external_id: "u2", segment_id: "seg-1" },
      { external_id: "u3", segment_id: "seg-1" },
    ];
    h.events = [
      { content_piece_id: "piece-1", actor_external_id: "u1" },
      { content_piece_id: "piece-2", actor_external_id: "u2" },
      { content_piece_id: "piece-3", actor_external_id: "u3" },
    ];
    h.pieces = [piece("piece-1"), piece("piece-2"), piece("piece-3")];
    h.existingPrefs = { id: "pref-1" };

    const result = await learnAndStorePreferences("ws-1");
    expect(result.updated).toBe(1);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(1);
  });

  it("passes empty tone/topics rather than fabricating values, per the documented data limitation", async () => {
    h.segments = [{ id: "seg-1", name: "Engaged Redditors" }];
    h.members = [
      { external_id: "u1", segment_id: "seg-1" },
      { external_id: "u2", segment_id: "seg-1" },
      { external_id: "u3", segment_id: "seg-1" },
    ];
    h.events = [
      { content_piece_id: "piece-1", actor_external_id: "u1" },
      { content_piece_id: "piece-2", actor_external_id: "u2" },
      { content_piece_id: "piece-3", actor_external_id: "u3" },
    ];
    h.pieces = [piece("piece-1"), piece("piece-2"), piece("piece-3")];

    await learnAndStorePreferences("ws-1");
    const call = h.learnSegmentPreferences.mock.calls[0][0];
    for (const post of call.topEngagedPosts) {
      expect(post.tone).toBe("");
      expect(post.topics).toEqual([]);
    }
  });
});
