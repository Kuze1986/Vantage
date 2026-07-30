/**
 * Service-to-service auth for portfolio consumers (DemoForge, Crucible, …).
 * Accepts `x-vantage-key` or `Authorization: Bearer <VANTAGE_SERVICE_KEY>`.
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { listAllWorkspaceIds } from "./workspace.js";

declare module "hono" {
  interface ContextVariableMap {
    serviceAuth: boolean;
  }
}

function configuredServiceKey(): string | null {
  const key = process.env.VANTAGE_SERVICE_KEY?.trim();
  return key || null;
}

export function extractServiceKey(c: Context): string | null {
  const headerKey = c.req.header("x-vantage-key")?.trim();
  if (headerKey) return headerKey;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    return token || null;
  }
  return null;
}

export function isValidServiceKey(key: string | null): boolean {
  const expected = configuredServiceKey();
  return Boolean(expected && key && key === expected);
}

/** Middleware: require VANTAGE_SERVICE_KEY. Sets serviceAuth=true. */
export async function serviceKeyMiddleware(c: Context, next: Next) {
  if (!configuredServiceKey()) {
    throw new HTTPException(503, {
      message: "VANTAGE_SERVICE_KEY is not configured on this API",
    });
  }
  if (!isValidServiceKey(extractServiceKey(c))) {
    throw new HTTPException(401, { message: "Invalid or missing Vantage service key" });
  }
  c.set("serviceAuth", true);

  // Resolve workspace for service calls: header → env default → first workspace
  const headerWs = c.req.header("x-workspace-id")?.trim();
  const envWs = process.env.VANTAGE_DEFAULT_WORKSPACE_ID?.trim();
  let workspaceId = headerWs || envWs || "";
  if (!workspaceId) {
    const ids = await listAllWorkspaceIds();
    workspaceId = ids[0] ?? "";
  }
  if (!workspaceId) {
    throw new HTTPException(503, { message: "No Vantage workspace available" });
  }
  c.set("workspaceId", workspaceId);
  c.set("workspaceRole", "viewer");
  c.set("user", { id: "service", email: "service@vantage" });
  await next();
}
