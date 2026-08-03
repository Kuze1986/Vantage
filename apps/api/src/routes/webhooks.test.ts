import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const h = vi.hoisted(() => ({
  pieceLookup: null as { id: string; workspace_id: string; channel_slug?: string } | null,
  inserts: [] as Array<Record<string, unknown>>,
  recordGrowthEvent: vi.fn(async () => {}),
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      if (table === "content_pieces") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.pieceLookup, error: null }) }) }) };
      }
      if (table === "engagement_events") {
        return { insert: (p: Record<string, unknown>) => { h.inserts.push(p); return Promise.resolve({ error: null }); } };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("../lib/growth.js", () => ({
  recordGrowthEvent: h.recordGrowthEvent,
  engagementKind: (t: string) => (/reply|comment|quote|mention/i.test(t) ? "reply" : "impression"),
}));
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("../adapters/x.js", () => ({ crcResponseToken: () => "" }));

import { webhooksRoutes } from "./webhooks.js";

const SECRET = "li-secret";
function post(body: unknown, sig?: string) {
  const raw = JSON.stringify(body);
  return webhooksRoutes.request("/linkedin", {
    method: "POST",
    headers: sig !== undefined ? { "x-li-signature": sig } : {},
    body: raw,
  });
}
const sign = (body: unknown) => createHmac("sha256", SECRET).update(JSON.stringify(body)).digest("base64");

beforeEach(() => {
  process.env.LINKEDIN_WEBHOOK_SECRET = SECRET;
  h.pieceLookup = null;
  h.inserts.length = 0;
  h.recordGrowthEvent.mockClear();
});

describe("LinkedIn webhook", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    const body = { eventType: "LIKE", shareId: "share-1" };
    const res = await post(body, "wrong-signature");
    expect(res.status).toBe(401);
    expect(h.inserts).toHaveLength(0);
  });

  it("accepts a valid signature but skips an unattributable event (no matching piece)", async () => {
    const body = { eventType: "LIKE", shareId: "share-unknown" };
    h.pieceLookup = null;
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "unmatched" });
    expect(h.inserts).toHaveLength(0); // engagement_events is workspace-scoped → never inserted unattributed
  });

  it("records a workspace-stamped engagement when the piece matches", async () => {
    const body = { eventType: "COMMENT", shareId: "share-1", eventId: "evt-9" };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      workspace_id: "ws-7",
      content_piece_id: "piece-1",
      event_type: "COMMENT",
    });
  });

  it("extracts actor_external_id from payload.actor when present", async () => {
    const body = { eventType: "LIKE", shareId: "share-1", actor: "urn:li:person:abc123" };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await post(body, sign(body));
    expect(h.inserts[0].actor_external_id).toBe("urn:li:person:abc123");
  });

  it("stores actor_external_id as null when the payload has no actor field", async () => {
    const body = { eventType: "LIKE", shareId: "share-1" };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await post(body, sign(body));
    expect(h.inserts[0].actor_external_id).toBeNull();
  });
});

describe("X webhook", () => {
  function postX(body: unknown) {
    return webhooksRoutes.request("/x", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("extracts actor_external_id from payload.user.id_str when present", async () => {
    const body = { event_type: "favorite", tweet_id: "tweet-1", user: { id_str: "x-user-42" } };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postX(body);
    expect(h.inserts[0].actor_external_id).toBe("x-user-42");
  });

  it("falls back to payload.favorited_by.id_str", async () => {
    const body = { event_type: "favorite", tweet_id: "tweet-1", favorited_by: { id_str: "x-user-99" } };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postX(body);
    expect(h.inserts[0].actor_external_id).toBe("x-user-99");
  });

  it("stores actor_external_id as null when no actor field is present", async () => {
    const body = { event_type: "favorite", tweet_id: "tweet-1" };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postX(body);
    expect(h.inserts[0].actor_external_id).toBeNull();
  });
});

describe("Email (Resend) webhook", () => {
  function postEmail(body: unknown) {
    return webhooksRoutes.request("/email", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("extracts actor_external_id from data.to[0] and sets a dedupable external_event_id", async () => {
    const body = { type: "email.opened", data: { email_id: "email-1", to: ["reader@example.com"] } };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postEmail(body);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].actor_external_id).toBe("reader@example.com");
    expect(h.inserts[0].external_event_id).toBe("email_email.opened_email-1");
  });

  it("falls back to data.email when data.to is absent", async () => {
    const body = { type: "email.clicked", data: { email_id: "email-2", email: "reader2@example.com" } };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postEmail(body);
    expect(h.inserts[0].actor_external_id).toBe("reader2@example.com");
  });

  it("stores actor_external_id as null when the payload has no recipient field", async () => {
    const body = { type: "email.bounced", data: { email_id: "email-3" } };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postEmail(body);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].actor_external_id).toBeNull();
    expect(h.inserts[0].external_event_id).toBe("email_email.bounced_email-3");
  });

  it("skips entirely (no insert) when the piece can't be attributed — no email_id at all", async () => {
    const body = { type: "email.bounced", data: {} };
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7" };
    await postEmail(body);
    expect(h.inserts).toHaveLength(0);
  });
});

describe("Conversion webhook", () => {
  function postConversion(body: unknown, sig?: string) {
    const raw = JSON.stringify(body);
    return webhooksRoutes.request("/conversion", {
      method: "POST",
      headers: sig !== undefined ? { "x-conversion-signature": sig } : {},
      body: raw,
    });
  }
  const signConversion = (body: unknown) =>
    createHmac("sha256", "conv-secret").update(JSON.stringify(body)).digest("hex");

  beforeEach(() => {
    delete process.env.CONVERSION_WEBHOOK_SECRET;
  });

  it("requires piece_id and rejects its absence with 400", async () => {
    const res = await postConversion({ event_type: "signup" });
    expect(res.status).toBe(400);
  });

  it("skips (200, no growth event) when the piece_id doesn't match any content piece", async () => {
    h.pieceLookup = null;
    const res = await postConversion({ piece_id: "unknown-piece" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "unmatched" });
    expect(h.recordGrowthEvent).not.toHaveBeenCalled();
  });

  it("records a conversion loop/signup growth event for a matched piece, defaulting event_type to signup", async () => {
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7", channel_slug: "email" };
    const res = await postConversion({ piece_id: "piece-1" });
    expect(res.status).toBe(200);
    expect(h.recordGrowthEvent).toHaveBeenCalledOnce();
    expect(h.recordGrowthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ loop: "conversion", kind: "signup", channel: "email" }),
    );
  });

  it("passes through a custom event_type and numeric value", async () => {
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7", channel_slug: "x" };
    await postConversion({ piece_id: "piece-1", event_type: "trial_start", value: 49.99 });
    expect(h.recordGrowthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ loop: "conversion", kind: "trial_start", channel: "x", value: 49.99 }),
    );
  });

  it("rejects a bad signature with 401 when CONVERSION_WEBHOOK_SECRET is configured", async () => {
    process.env.CONVERSION_WEBHOOK_SECRET = "conv-secret";
    const body = { piece_id: "piece-1" };
    const res = await postConversion(body, "wrong-signature");
    expect(res.status).toBe(401);
    expect(h.recordGrowthEvent).not.toHaveBeenCalled();
  });

  it("accepts a correctly-signed request when CONVERSION_WEBHOOK_SECRET is configured", async () => {
    process.env.CONVERSION_WEBHOOK_SECRET = "conv-secret";
    h.pieceLookup = { id: "piece-1", workspace_id: "ws-7", channel_slug: "x" };
    const body = { piece_id: "piece-1" };
    const res = await postConversion(body, signConversion(body));
    expect(res.status).toBe(200);
    expect(h.recordGrowthEvent).toHaveBeenCalledOnce();
  });
});
