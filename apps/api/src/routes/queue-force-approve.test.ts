import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const h = vi.hoisted(() => ({
  selects: [] as Array<{ data: unknown; error: unknown }> ,
  updates: [] as Array<Record<string, unknown>>,
  activity: [] as Array<Record<string, unknown>>,
}));
const maybeAutoQueuePiece = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ single: () => Promise.resolve(h.selects.shift()) }) }),
      }),
      update: (payload: Record<string, unknown>) => {
        h.updates.push(payload);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));
vi.mock("../lib/auto-queue.js", () => ({ maybeAutoQueuePiece }));
vi.mock("../lib/activity.js", () => ({
  logActivity: (event: Record<string, unknown>) => { h.activity.push(event); return Promise.resolve(); },
}));
vi.mock("../lib/publish-pack.js", () => ({ buildPublishPack: vi.fn(), MANUAL_PUBLISH_CHANNELS: new Set() }));
vi.mock("../services/scheduler.js", () => ({ scheduleContentPiece: vi.fn() }));

import { queueRoutes } from "./queue.js";

const ID = "11111111-1111-1111-1111-111111111111";

function app() {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("workspaceId", "ws-1"); await next(); });
  app.route("/", queueRoutes);
  return app;
}

beforeEach(() => {
  h.selects.length = 0;
  h.updates.length = 0;
  h.activity.length = 0;
  maybeAutoQueuePiece.mockReset().mockResolvedValue(true);
});

describe("force approval", () => {
  it("records the reason and returns a rejected piece to the media gate", async () => {
    h.selects.push(
      { data: { id: ID, status: "rejected", media_status: "pending", audit_notes: "[fail] unsupported claim", content_payload: { body: "Accurate draft" } }, error: null },
      { data: { id: ID, status: "approved", media_status: "pending", scheduled_for: "2026-08-15T00:00:00.000Z" }, error: null },
    );

    const response = await app().request(`/${ID}/force-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Verified against the approved fact sheet" }),
    });

    expect(response.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ status: "approved" });
    expect(h.updates[0].content_payload).toMatchObject({
      manual_approval: { reason: "Verified against the approved fact sheet" },
    });
    expect(h.updates[0].audit_notes).toContain("[force-approved] Verified against the approved fact sheet");
    expect(maybeAutoQueuePiece).toHaveBeenCalledWith("ws-1", ID);
    expect(h.activity[0]).toMatchObject({ event_type: "piece_force_approved" });
  });

  it("does not allow a non-rejected piece to bypass the normal flow", async () => {
    h.selects.push({ data: { id: ID, status: "queued", media_status: "ready", audit_notes: null, content_payload: {} }, error: null });
    const response = await app().request(`/${ID}/force-approve`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
});
