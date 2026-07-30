/**
 * Auth for /v1/marketing: accept service key OR operator JWT + workspace.
 */

import type { Context, Next } from "hono";
import { authMiddleware, workspaceGuard } from "./auth.js";
import { extractServiceKey, isValidServiceKey } from "./service-auth.js";
import { listAllWorkspaceIds } from "./workspace.js";
import { HTTPException } from "hono/http-exception";

export async function marketingAuth(c: Context, next: Next) {
  if (isValidServiceKey(extractServiceKey(c))) {
    c.set("serviceAuth", true);
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
    return;
  }

  // Fall through to normal JWT + workspace membership
  await authMiddleware(c, async () => {
    await workspaceGuard(c, next);
  });
}
