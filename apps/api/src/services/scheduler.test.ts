import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state, hoisted so the vi.mock factories can reference it.
const h = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; eqs: Record<string, unknown> }>,
  postTweet: vi.fn(),
  sendAlert: vi.fn(async () => {}),
}));

// Minimal chainable Supabase stub: records every .update(payload).eq(...).eq(...)
// and resolves to { error: null } when awaited.
vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const rec = { table, payload, eqs: {} as Record<string, unknown> };
          h.updates.push(rec);
          const chain: Record<string, unknown> = {
            eq(k: string, v: unknown) { rec.eqs[k] = v; return chain; },
            then(resolve: (r: { error: null }) => void) { resolve({ error: null }); },
          };
          return chain;
        },
      };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../adapters/x.js", () => ({ postTweet: h.postTweet, crcResponseToken: () => "" }));
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../lib/alert.js", () => ({ sendAlert: h.sendAlert }));

import { publishPiece } from "./scheduler.js";

const WS = "ws-1";
const xChannel = { slug: "x", enabled: true, cadence_config: {} };
function piece(retry_count: number) {
  return { id: "piece-1", channel_slug: "x", format: "tweet", content_payload: { body: "hi" }, retry_count };
}
const lastUpdate = () => h.updates[h.updates.length - 1];

beforeEach(() => {
  h.updates.length = 0;
  h.postTweet.mockReset();
  h.sendAlert.mockClear();
});

describe("publishPiece state machine", () => {
  it("on success → published, records external id, releases the lock", async () => {
    h.postTweet.mockResolvedValue({ id: "tweet-99" });
    await publishPiece(WS, piece(0), xChannel);

    const u = lastUpdate();
    expect(u.table).toBe("content_pieces");
    expect(u.payload.status).toBe("published");
    expect(u.payload.external_post_id).toBe("tweet-99");
    expect(u.payload.locked_at).toBeNull();
    expect(u.eqs.workspace_id).toBe(WS);
    expect(u.eqs.id).toBe("piece-1");
  });

  it("on first failure → re-queued with retry_count 1 and a backoff retry_after, lock released", async () => {
    h.postTweet.mockRejectedValue(new Error("boom"));
    await expect(publishPiece(WS, piece(0), xChannel)).rejects.toThrow("boom");

    const u = lastUpdate();
    expect(u.payload.status).toBe("queued"); // released back for retry
    expect(u.payload.retry_count).toBe(1);
    expect(u.payload.retry_after).toBeTypeOf("string");
    expect(u.payload.locked_at).toBeNull();
    expect(h.sendAlert).not.toHaveBeenCalled();
  });

  it("after retries are exhausted → failed permanently with an alert", async () => {
    h.postTweet.mockRejectedValue(new Error("still down"));
    // retry_count 3 is past the [5m,15m,1h] backoff schedule → give up.
    await expect(publishPiece(WS, piece(3), xChannel)).rejects.toThrow("still down");

    const u = lastUpdate();
    expect(u.payload.status).toBe("failed");
    expect(u.payload.locked_at).toBeNull();
    expect(h.sendAlert).toHaveBeenCalledOnce();
  });

  it("on rate limit → re-queued without burning a retry slot", async () => {
    const { RateLimitError } = await import("../lib/rate-limit-error.js");
    h.postTweet.mockRejectedValue(new RateLimitError("429", 60_000));
    await expect(publishPiece(WS, piece(0), xChannel)).rejects.toBeInstanceOf(RateLimitError);

    const u = lastUpdate();
    expect(u.payload.status).toBe("queued");
    expect(u.payload.retry_after).toBeTypeOf("string");
    expect(u.payload.locked_at).toBeNull();
    // crucially, retry_count is NOT touched on a rate-limit reschedule
    expect(u.payload).not.toHaveProperty("retry_count");
    expect(h.sendAlert).not.toHaveBeenCalled();
  });
});
