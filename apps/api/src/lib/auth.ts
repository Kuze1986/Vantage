import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAnon, getSupabaseAdmin } from "./supabase.js";
import { resolveOrCreateWorkspace } from "./workspace.js";

export type AuthedUser = { id: string; email?: string };

declare module "hono" {
  interface ContextVariableMap {
    user: AuthedUser;
    workspaceId: string;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Small TTL cache of verified (user, workspace) pairs so the guard does not hit
// the DB on every request. Ownership rarely changes; 60s staleness is fine.
const OWNERSHIP_TTL_MS = 60_000;
const ownershipCache = new Map<string, number>(); // key `${userId}:${workspaceId}` -> expiry ms

/**
 * Workspace scoping guard. Runs after authMiddleware and ALWAYS resolves a
 * workspace for the request, exposed as c.get("workspaceId"). Every authed
 * route relies on it — core pipeline tables are now workspace-scoped, so a
 * request can never be left unscoped.
 *
 * - If the request carries an `x-workspace-id` header, verify the authenticated
 *   user actually owns that workspace (prevents IDOR — changing the header to
 *   another tenant's id).
 * - If the header is absent, fall back to the user's own (lazily provisioned)
 *   workspace, mirroring GET /v1/workspaces/me.
 */
export async function workspaceGuard(c: Context, next: Next) {
  const user = c.get("user");
  const headerWs = c.req.header("x-workspace-id");

  if (headerWs) {
    if (!UUID_RE.test(headerWs)) {
      throw new HTTPException(403, { message: "Invalid workspace" });
    }
    const key = `${user.id}:${headerWs}`;
    const cached = ownershipCache.get(key);
    if (!cached || cached < Date.now()) {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("workspaces")
        .select("id")
        .eq("id", headerWs)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw new HTTPException(500, { message: error.message });
      if (!data) throw new HTTPException(403, { message: "You do not have access to this workspace" });
      ownershipCache.set(key, Date.now() + OWNERSHIP_TTL_MS);
    }
    c.set("workspaceId", headerWs);
  } else {
    // No header — scope to the user's default workspace (create on first use).
    c.set("workspaceId", await resolveOrCreateWorkspace(user.id));
  }
  await next();
}

/** Stub super-admin: any valid Supabase JWT passes; optional BRANDON_USER_ID env pins a single user. */
export async function authMiddleware(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Authorization bearer token" });
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    throw new HTTPException(401, { message: "Empty bearer token" });
  }
  const anon = getSupabaseAnon();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) {
    throw new HTTPException(401, { message: error?.message ?? "Invalid session" });
  }
  const pinned = process.env.BRANDON_USER_ID;
  if (pinned && data.user.id !== pinned) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  c.set("user", { id: data.user.id, email: data.user.email ?? undefined });
  await next();
}
