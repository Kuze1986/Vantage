import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const { getMembershipRole, resolveOrCreateWorkspace } = vi.hoisted(() => ({
  getMembershipRole: vi.fn(),
  resolveOrCreateWorkspace: vi.fn(),
}));
const h = vi.hoisted(() => ({ upserts: [] as Array<Record<string, unknown>> }));

vi.mock("../lib/workspace.js", () => ({ getMembershipRole, resolveOrCreateWorkspace }));
vi.mock("../lib/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from() {
      return {
        upsert(payload: Record<string, unknown>) { h.upserts.push(payload); return Promise.resolve({ error: null }); },
        select() { return { eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }; },
      };
    },
  }),
}));

import { workspaceRoutes } from "./workspaces.js";

const WS = "ws-1";
function appAs(userId: string) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: userId }); await next(); });
  app.route("/", workspaceRoutes);
  return app;
}
const addBody = (user_id: string, role = "editor") =>
  ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id, role }) });

beforeEach(() => {
  getMembershipRole.mockReset();
  h.upserts.length = 0;
});

describe("workspace member management", () => {
  it("forbids a viewer from adding members", async () => {
    getMembershipRole.mockResolvedValue("viewer");
    const res = await appAs("viewer-user").request(`/${WS}/members`, addBody("11111111-1111-1111-1111-111111111111"));
    expect(res.status).toBe(403);
    expect(h.upserts).toHaveLength(0);
  });

  it("lets an admin add a member", async () => {
    getMembershipRole.mockResolvedValue("admin");
    const res = await appAs("admin-user").request(`/${WS}/members`, addBody("22222222-2222-2222-2222-222222222222", "editor"));
    expect(res.status).toBe(201);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({ workspace_id: WS, user_id: "22222222-2222-2222-2222-222222222222", role: "editor" });
  });

  it("forbids listing members for a non-member", async () => {
    getMembershipRole.mockResolvedValue(null);
    const res = await appAs("outsider").request(`/${WS}/members`);
    expect(res.status).toBe(403);
  });
});
