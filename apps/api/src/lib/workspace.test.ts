import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  membership: [] as Array<{ workspace_id: string; role: string }>,
  channelUpserts: [] as Array<Record<string, unknown>[]>,
}));

vi.mock("./supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "workspace_members") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: h.membership, error: null }) }) }) }) };
      }
      if (table === "channels") {
        return { upsert: (rows: Record<string, unknown>[]) => { h.channelUpserts.push(rows); return Promise.resolve({ error: null }); } };
      }
      return { select: () => ({ eq: () => ({}) }) };
    },
  };
  return { getSupabaseAdmin: () => sb };
});

import { resolveOrCreateWorkspace } from "./workspace.js";

beforeEach(() => {
  h.membership = [];
  h.channelUpserts.length = 0;
});

describe("resolveOrCreateWorkspace", () => {
  it("self-heals default channels for an existing membership, not just on creation", async () => {
    h.membership = [{ workspace_id: "ws-existing", role: "owner" }];
    const ws = await resolveOrCreateWorkspace("user-1");
    expect(ws).toBe("ws-existing");
    // This is the fix for a real production bug: a workspace created before threads/bluesky
    // were added to DEFAULT_CHANNELS never got backfilled, and content generation for those
    // channels failed with a content_pieces_channel_fk violation. Every resolve now keeps
    // the workspace's channel set in sync with DEFAULT_CHANNELS, idempotently.
    expect(h.channelUpserts).toHaveLength(1);
    const slugs = h.channelUpserts[0].map((r) => r.slug);
    expect(slugs).toEqual(expect.arrayContaining(["x", "linkedin", "reddit", "threads", "bluesky", "email", "tiktok", "instagram", "facebook"]));
    expect(h.channelUpserts[0].every((r) => r.workspace_id === "ws-existing")).toBe(true);
  });

  it("prefers an owner membership over other roles", async () => {
    h.membership = [
      { workspace_id: "ws-editor", role: "editor" },
      { workspace_id: "ws-owner", role: "owner" },
    ];
    const ws = await resolveOrCreateWorkspace("user-1");
    expect(ws).toBe("ws-owner");
  });
});
