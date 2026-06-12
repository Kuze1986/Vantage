import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context, Next } from "hono";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// maybeSingle backs the workspaces ownership lookup; resolveOrCreateWorkspace
// backs the header-absent fallback. Hoisted so the vi.mock factories can see them.
const { maybeSingle, resolveOrCreateWorkspace } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  resolveOrCreateWorkspace: vi.fn(),
}));

vi.mock("./supabase.js", () => ({
  getSupabaseAnon: () => ({}),
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle }) }),
      }),
    }),
  }),
}));

vi.mock("./workspace.js", () => ({ resolveOrCreateWorkspace }));

import { workspaceGuard } from "./auth.js";

// Minimal Hono Context stub exposing only what the guard touches.
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
const OWNED = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  maybeSingle.mockReset();
  resolveOrCreateWorkspace.mockReset();
  (next as ReturnType<typeof vi.fn>).mockClear();
});

describe("workspaceGuard", () => {
  it("rejects a malformed workspace id without hitting the DB", async () => {
    const { ctx } = makeCtx("not-a-uuid", "user-a");
    await expect(workspaceGuard(ctx, next)).rejects.toMatchObject({ status: 403 });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a well-formed id the user does not own (IDOR)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { ctx } = makeCtx(OWNED, "attacker"); // unique user so cache can't satisfy it
    await expect(workspaceGuard(ctx, next)).rejects.toMatchObject({ status: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts and scopes a workspace the user owns", async () => {
    maybeSingle.mockResolvedValue({ data: { id: OWNED }, error: null });
    const { ctx, store } = makeCtx(OWNED, "owner-1");
    await workspaceGuard(ctx, next);
    expect(store.workspaceId).toBe(OWNED);
    expect(next).toHaveBeenCalledOnce();
  });

  it("surfaces a DB error as a 500", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { ctx } = makeCtx(OWNED, "owner-2");
    await expect(workspaceGuard(ctx, next)).rejects.toMatchObject({ status: 500 });
  });

  it("falls back to the user's default workspace when no header is sent", async () => {
    resolveOrCreateWorkspace.mockResolvedValue("default-ws-id");
    const { ctx, store } = makeCtx(undefined, "owner-3");
    await workspaceGuard(ctx, next);
    expect(resolveOrCreateWorkspace).toHaveBeenCalledWith("owner-3");
    expect(store.workspaceId).toBe("default-ws-id");
    expect(next).toHaveBeenCalledOnce();
  });
});
