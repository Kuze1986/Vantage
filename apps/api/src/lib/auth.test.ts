import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context, Next } from "hono";

// The guard authorizes by membership (getMembershipRole) and falls back to
// resolveOrCreateWorkspace when no header is present. Mock both.
const { getMembershipRole, resolveOrCreateWorkspace } = vi.hoisted(() => ({
  getMembershipRole: vi.fn(),
  resolveOrCreateWorkspace: vi.fn(),
}));

vi.mock("./supabase.js", () => ({ getSupabaseAnon: () => ({}), getSupabaseAdmin: () => ({}) }));
vi.mock("./workspace.js", () => ({ getMembershipRole, resolveOrCreateWorkspace }));

import { workspaceGuard } from "./auth.js";

function makeCtx(headerWs: string | undefined, userId: string): { ctx: Context; store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  const ctx = {
    req: { header: (k: string) => (k === "x-workspace-id" ? headerWs : undefined) },
    get: (k: string) => (k === "user" ? { id: userId } : store[k]),
    set: (k: string, v: unknown) => { store[k] = v; },
  } as unknown as Context;
  return { ctx, store };
}

const next: Next = vi.fn(async () => {});
// Distinct ids per test so the guard's 60s membership cache can't bleed across cases.
let n = 0;
const freshWs = () => `1111111${(n++).toString(16).padStart(1, "0")}-1111-1111-1111-111111111111`;

beforeEach(() => {
  getMembershipRole.mockReset();
  resolveOrCreateWorkspace.mockReset();
  (next as ReturnType<typeof vi.fn>).mockClear();
});

describe("workspaceGuard", () => {
  it("rejects a malformed workspace id without checking membership", async () => {
    const { ctx } = makeCtx("not-a-uuid", "user-a");
    await expect(workspaceGuard(ctx, next)).rejects.toMatchObject({ status: 403 });
    expect(getMembershipRole).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a workspace the user is not a member of (IDOR)", async () => {
    getMembershipRole.mockResolvedValue(null);
    const { ctx } = makeCtx(freshWs(), "attacker");
    await expect(workspaceGuard(ctx, next)).rejects.toMatchObject({ status: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a member and exposes their role", async () => {
    getMembershipRole.mockResolvedValue("editor");
    const ws = freshWs();
    const { ctx, store } = makeCtx(ws, "member-1");
    await workspaceGuard(ctx, next);
    expect(store.workspaceId).toBe(ws);
    expect(store.workspaceRole).toBe("editor");
    expect(next).toHaveBeenCalledOnce();
  });

  it("falls back to a provisioned workspace when no header is sent", async () => {
    resolveOrCreateWorkspace.mockResolvedValue("default-ws-id");
    getMembershipRole.mockResolvedValue("owner");
    const { ctx, store } = makeCtx(undefined, "owner-3");
    await workspaceGuard(ctx, next);
    expect(resolveOrCreateWorkspace).toHaveBeenCalledWith("owner-3");
    expect(store.workspaceId).toBe("default-ws-id");
    expect(store.workspaceRole).toBe("owner");
    expect(next).toHaveBeenCalledOnce();
  });
});
