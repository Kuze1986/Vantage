import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAnon } from "./supabase.js";
import { resolveOrCreateWorkspace, getMembershipRole, type WorkspaceRole } from "./workspace.js";

export type AuthedUser = { id: string; email?: string };

declare module "hono" {
  interface ContextVariableMap {
    user: AuthedUser;
    workspaceId: string;
    workspaceRole: WorkspaceRole;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Small TTL cache of verified (user, workspace) → role so the guard does not hit
// the DB on every request. Membership rarely changes; 60s staleness is fine.
const OWNERSHIP_TTL_MS = 60_000;
const ownershipCache = new Map<string, { role: WorkspaceRole; expiry: number }>(); // key `${userId}:${workspaceId}`

/**
 * Workspace scoping guard. Runs after authMiddleware and ALWAYS resolves a
 * workspace for the request, exposed as c.get("workspaceId"). Every authed
 * route relies on it — core pipeline tables are now workspace-scoped, so a
 * request can never be left unscoped.
 *
 * - If the request carries an `x-workspace-id` header, verify the authenticated
 *   user is a MEMBER of that workspace (prevents IDOR — changing the header to
 *   another tenant's id). The member's role is exposed as c.get("workspaceRole").
 * - If the header is absent, fall back to a workspace the user belongs to
 *   (lazily provisioned), mirroring GET /v1/workspaces/me.
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
    let role: WorkspaceRole;
    if (cached && cached.expiry >= Date.now()) {
      role = cached.role;
    } else {
      const found = await getMembershipRole(headerWs, user.id);
      if (!found) throw new HTTPException(403, { message: "You do not have access to this workspace" });
      role = found;
      ownershipCache.set(key, { role, expiry: Date.now() + OWNERSHIP_TTL_MS });
    }
    c.set("workspaceId", headerWs);
    c.set("workspaceRole", role);
  } else {
    // No header — scope to a workspace the user belongs to (create on first use).
    const ws = await resolveOrCreateWorkspace(user.id);
    c.set("workspaceId", ws);
    c.set("workspaceRole", (await getMembershipRole(ws, user.id)) ?? "owner");
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
