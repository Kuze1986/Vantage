import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const h = vi.hoisted(() => ({
  pieceLookup: null as { id: string; workspace_id: string } | null,
  inserts: [] as Array<Record<string, unknown>>,
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
  recordGrowthEvent: vi.fn(async () => {}),
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
});
