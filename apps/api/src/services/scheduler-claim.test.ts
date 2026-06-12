import { describe, it, expect, vi, beforeEach } from "vitest";

// Controls whether the atomic claim (queued→publishing) returns a row.
const h = vi.hoisted(() => ({
  claimData: [] as Array<{ id: string }>,
  postTweet: vi.fn(async () => ({ id: "tweet-1" })),
}));

// Supabase stub that distinguishes the queries cadenceTickForWorkspace issues:
//   - select on content_pieces (no prior update) → the candidate queued piece
//   - update+select on content_pieces            → the CAS claim (returns h.claimData)
//   - select on channels                          → the routing channel row
//   - any other update                            → { error: null }
vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      const st = { updated: false, selectedAfterUpdate: false };
      const result = () => {
        if (table === "content_pieces" && st.updated && st.selectedAfterUpdate) return { data: h.claimData, error: null };
        if (table === "content_pieces" && !st.updated)
          return { data: [{ id: "piece-1", channel_slug: "x", format: "tweet", content_payload: { body: "hi" }, retry_count: 0 }], error: null };
        if (table === "channels") return { data: [{ slug: "x", enabled: true, cadence_config: {} }], error: null };
        return { error: null };
      };
      const chain: Record<string, unknown> = {
        select() { if (st.updated) st.selectedAfterUpdate = true; return chain; },
        update() { st.updated = true; return chain; },
        eq() { return chain; }, lte() { return chain; }, lt() { return chain; },
        or() { return chain; }, limit() { return chain; }, order() { return chain; },
        then(resolve: (r: unknown) => void) { resolve(result()); },
      };
      return chain;
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../adapters/x.js", () => ({ postTweet: h.postTweet, crcResponseToken: () => "" }));
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/alert.js", () => ({ sendAlert: vi.fn(async () => {}) }));

import { cadenceTickForWorkspace } from "./scheduler.js";

beforeEach(() => h.postTweet.mockClear());

describe("cadence claim lock", () => {
  it("publishes the piece when the claim succeeds", async () => {
    h.claimData = [{ id: "piece-1" }]; // CAS won
    await cadenceTickForWorkspace("ws-1");
    expect(h.postTweet).toHaveBeenCalledOnce();
  });

  it("skips the piece when another worker already claimed it (CAS returns no rows)", async () => {
    h.claimData = []; // CAS lost — someone else flipped it to 'publishing' first
    await cadenceTickForWorkspace("ws-1");
    expect(h.postTweet).not.toHaveBeenCalled();
  });
});
