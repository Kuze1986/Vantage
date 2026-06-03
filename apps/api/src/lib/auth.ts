import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAnon, getSupabaseAdmin } from "./supabase.js";

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
 * Workspace ownership guard. Runs after authMiddleware.
 *
 * When a request carries an `x-workspace-id` header, verify the authenticated
 * user actually owns that workspace before any route handler trusts it. Without
 * this, any logged-in user could read/write another tenant's workspace-scoped
 * data simply by changing the header (IDOR).
 *
 * Requests with no header are left alone — routes that need a workspace enforce
 * its presence themselves; routes on global tables don't need one.
 */
export async function workspaceGuard(c: Context, next: Next) {
  const workspaceId = c.req.header("x-workspace-id");
  if (workspaceId) {
    if (!UUID_RE.test(workspaceId)) {
      throw new HTTPException(403, { message: "Invalid workspace" });
    }
    const user = c.get("user");
    const key = `${user.id}:${workspaceId}`;
    const cached = ownershipCache.get(key);
    if (!cached || cached < Date.now()) {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw new HTTPException(500, { message: error.message });
      if (!data) throw new HTTPException(403, { message: "You do not have access to this workspace" });
      ownershipCache.set(key, Date.now() + OWNERSHIP_TTL_MS);
    }
    c.set("workspaceId", workspaceId);
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
