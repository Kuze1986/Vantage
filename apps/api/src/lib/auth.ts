import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAnon } from "./supabase.js";

export type AuthedUser = { id: string; email?: string };

declare module "hono" {
  interface ContextVariableMap {
    user: AuthedUser;
  }
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
