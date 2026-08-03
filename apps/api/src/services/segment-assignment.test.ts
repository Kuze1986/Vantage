import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  segments: [] as Array<{ id: string; definition: unknown }>,
  events: [] as Array<{ content_piece_id: string | null; actor_external_id: string | null; event_type: string; occurred_at: string }>,
  pieces: [] as Array<{ id: string; channel_slug: string }>,
  existingMembers: new Map<string, { id: string; total_interactions: number }>(),
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "segments") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: h.segments, error: null }) }) }) };
      }
      if (table === "engagement_events") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                gte: () => ({
                  order: () => ({
                    limit: async () => ({ data: h.events, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "content_pieces") {
        return { select: () => ({ in: async () => ({ data: h.pieces, error: null }) }) };
      }
      if (table === "segment_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: (_col: string, platform: string) => ({
                    maybeSingle: async () => {
                      const key = [...h.existingMembers.keys()].find((k) => k.endsWith(`|${platform}`));
                      return { data: key ? h.existingMembers.get(key) : null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
          insert: (p: Record<string, unknown>) => { h.inserts.push(p); return Promise.resolve({ error: null }); },
          update: (p: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => { h.updates.push({ id, payload: p }); return Promise.resolve({ error: null }); },
          }),
        };
      }
      return { select: () => ({ eq: () => ({}) }), insert: () => Promise.resolve({ error: null }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));

import { assignSegmentMembers } from "./segment-assignment.js";

beforeEach(() => {
  h.segments = [];
  h.events = [];
  h.pieces = [];
  h.existingMembers = new Map();
  h.inserts.length = 0;
  h.updates.length = 0;
});

describe("assignSegmentMembers", () => {
  it("returns zero everything with no active segments", async () => {
    h.segments = [];
    const result = await assignSegmentMembers("ws-1");
    expect(result).toEqual({ segmentsProcessed: 0, actorsEvaluated: 0, membersUpserted: 0 });
    expect(h.inserts).toHaveLength(0);
  });

  it("matches an 'all' rule set on source_platform + engagement_count and inserts a new member", async () => {
    h.segments = [
      {
        id: "seg-1",
        definition: { match_type: "all", rules: [{ field: "source_platform", operator: "eq", value: "reddit" }, { field: "engagement_count", operator: "gte", value: 2 }] },
      },
    ];
    h.pieces = [{ id: "piece-1", channel_slug: "reddit" }];
    h.events = [
      { content_piece_id: "piece-1", actor_external_id: "user-a", event_type: "reddit_score", occurred_at: "2026-08-01T00:00:00Z" },
      { content_piece_id: "piece-1", actor_external_id: "user-a", event_type: "reddit_comment_count", occurred_at: "2026-08-01T01:00:00Z" },
    ];

    const result = await assignSegmentMembers("ws-1");
    expect(result.membersUpserted).toBe(1);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      workspace_id: "ws-1",
      segment_id: "seg-1",
      external_id: "user-a",
      source_platform: "reddit",
      total_interactions: 2,
    });
  });

  it("does not match when engagement_count falls short of the threshold", async () => {
    h.segments = [
      { id: "seg-1", definition: { match_type: "all", rules: [{ field: "engagement_count", operator: "gte", value: 5 }] } },
    ];
    h.pieces = [{ id: "piece-1", channel_slug: "x" }];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "user-b", event_type: "like", occurred_at: "2026-08-01T00:00:00Z" }];

    const result = await assignSegmentMembers("ws-1");
    expect(result.membersUpserted).toBe(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("'any' match_type matches when only one of several rules passes", async () => {
    h.segments = [
      {
        id: "seg-1",
        definition: { match_type: "any", rules: [{ field: "source_platform", operator: "eq", value: "linkedin" }, { field: "event_type", operator: "contains", value: "reply" }] },
      },
    ];
    h.pieces = [{ id: "piece-1", channel_slug: "x" }];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "user-c", event_type: "reply", occurred_at: "2026-08-01T00:00:00Z" }];

    const result = await assignSegmentMembers("ws-1");
    expect(result.membersUpserted).toBe(1);
  });

  it("skips actors on platforms segment_members doesn't allow (e.g. tiktok)", async () => {
    h.segments = [{ id: "seg-1", definition: { match_type: "all", rules: [{ field: "engagement_count", operator: "gte", value: 1 }] } }];
    h.pieces = [{ id: "piece-1", channel_slug: "tiktok" }];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "user-d", event_type: "like", occurred_at: "2026-08-01T00:00:00Z" }];

    const result = await assignSegmentMembers("ws-1");
    expect(result.membersUpserted).toBe(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("ignores an unrecognized rule field rather than throwing", async () => {
    h.segments = [{ id: "seg-1", definition: { match_type: "all", rules: [{ field: "made_up_field", operator: "eq", value: "x" }] } }];
    h.pieces = [{ id: "piece-1", channel_slug: "reddit" }];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "user-e", event_type: "reddit_score", occurred_at: "2026-08-01T00:00:00Z" }];

    await expect(assignSegmentMembers("ws-1")).resolves.toMatchObject({ membersUpserted: 0 });
  });

  it("updates an existing member's total_interactions instead of inserting a duplicate", async () => {
    h.segments = [{ id: "seg-1", definition: { match_type: "all", rules: [{ field: "engagement_count", operator: "gte", value: 1 }] } }];
    h.pieces = [{ id: "piece-1", channel_slug: "reddit" }];
    h.events = [{ content_piece_id: "piece-1", actor_external_id: "user-f", event_type: "reddit_score", occurred_at: "2026-08-01T00:00:00Z" }];
    h.existingMembers.set("user-f|reddit", { id: "member-1", total_interactions: 3 });

    const result = await assignSegmentMembers("ws-1");
    expect(result.membersUpserted).toBe(1);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].id).toBe("member-1");
    expect(h.updates[0].payload.total_interactions).toBe(1);
  });
});
