import { describe, it, expect, vi, beforeEach } from "vitest";

// Captures every content_pieces UPDATE so we can assert the audit-gated status.
const h = vi.hoisted(() => ({
  cpUpdates: [] as Array<Record<string, unknown>>,
  auditContent: vi.fn(),
  generateContent: vi.fn(async () => ({ format: "tweet", content_payload: { body: "x" }, text_preview: "x" })),
  pickNextTopic: vi.fn(async () => ({ id: "t1", topic_text: "hi", vertical: null })),
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from(table: string) {
      const st = { op: "" as string };
      const chain: Record<string, unknown> = {
        select(_s: unknown, opts?: { head?: boolean }) { st.op = opts?.head ? "count" : "select"; return chain; },
        insert() { st.op = "insert"; return chain; },
        update(p: Record<string, unknown>) { st.op = "update"; if (table === "content_pieces") h.cpUpdates.push(p); return chain; },
        eq() { return chain; }, gte() { return chain; }, limit() { return chain; },
        single() { return Promise.resolve({ data: { id: "p1" }, error: null }); }, // content_pieces insert
        then(resolve: (r: unknown) => void) {
          if (table === "channels") return resolve({ data: [{ slug: "x", enabled: true, cadence_config: { auto_approve: true, posts_per_day: 1, posting_hours: [9] } }], error: null });
          if (table === "brand_voice") return resolve({ data: [{ name: "N", description: "d", per_channel_tone: {}, off_topics: [] }], error: null });
          if (table === "content_pieces" && st.op === "count") return resolve({ count: 0, error: null });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});

vi.mock("./ilita.js", () => ({ auditContent: h.auditContent }));
vi.mock("./kuze.js", () => ({ generateContent: h.generateContent }));
vi.mock("./source.js", () => ({ pickNextTopic: h.pickNextTopic }));
vi.mock("../lib/utm.js", () => ({ tagUrls: (v: string) => v }));
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));

import { autoGenerateTickForWorkspace } from "./scheduler.js";

// The piece's status update is the one carrying a `status` field (the earlier
// UTM update only touches content_payload).
const statusUpdate = () => h.cpUpdates.find((u) => "status" in u);

beforeEach(() => {
  h.cpUpdates.length = 0;
  h.auditContent.mockReset();
  h.generateContent.mockClear();
});

describe("auto-generate audit gating", () => {
  it("audit pass → auto-approves and queues the piece", async () => {
    h.auditContent.mockResolvedValue({ verdict: "pass", feedback: "" });
    await autoGenerateTickForWorkspace("ws-1");
    expect(statusUpdate()?.status).toBe("queued");
  });

  it("audit fail then regen pass → approved", async () => {
    h.auditContent
      .mockResolvedValueOnce({ verdict: "fail", feedback: "fix tone" })
      .mockResolvedValueOnce({ verdict: "pass", feedback: "" });
    await autoGenerateTickForWorkspace("ws-1");
    expect(h.generateContent).toHaveBeenCalledTimes(2); // initial + one regen
    expect(statusUpdate()?.status).toBe("approved");
  });

  it("audit fail then regen fail → rejected", async () => {
    h.auditContent
      .mockResolvedValueOnce({ verdict: "fail", feedback: "off-brand" })
      .mockResolvedValueOnce({ verdict: "fail", feedback: "still off-brand" });
    await autoGenerateTickForWorkspace("ws-1");
    expect(statusUpdate()?.status).toBe("rejected");
  });
});
