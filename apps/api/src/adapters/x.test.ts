import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  channelRows: [] as Array<{ workspace_id: string; auth_state: unknown }>,
  updates: [] as Array<{ payload: Record<string, unknown>; eqs: Record<string, unknown> }>,
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from() {
      return {
        select() {
          // .select(...).eq("slug","x") → resolves the channel rows
          return { eq: () => Promise.resolve({ data: h.channelRows, error: null }) };
        },
        update(payload: Record<string, unknown>) {
          const rec = { payload, eqs: {} as Record<string, unknown> };
          h.updates.push(rec);
          const chain: Record<string, unknown> = { eq(k: string, v: unknown) { rec.eqs[k] = v; return chain; }, then(r: (x: { error: null }) => void) { r({ error: null }); } };
          return chain;
        },
      };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));

import { exchangeCodeForTokens } from "./x.js";

beforeEach(() => {
  h.channelRows = [];
  h.updates.length = 0;
});

describe("x OAuth exchangeCodeForTokens — multi-tenant state resolution", () => {
  it("rejects a state that matches no workspace's pending OAuth", async () => {
    h.channelRows = [
      { workspace_id: "ws-a", auth_state: { pending_oauth: { state: "state-a" } } },
      { workspace_id: "ws-b", auth_state: { pending_oauth: { state: "state-b" } } },
    ];
    await expect(exchangeCodeForTokens("code", "not-a-real-state")).rejects.toThrow("Invalid OAuth state");
    expect(h.updates).toHaveLength(0); // nothing written for an unrecognized state
  });

  it("rejects when no channel has a pending OAuth at all", async () => {
    h.channelRows = [{ workspace_id: "ws-a", auth_state: {} }];
    await expect(exchangeCodeForTokens("code", "state-a")).rejects.toThrow("Invalid OAuth state");
  });
});
