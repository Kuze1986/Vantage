import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { generatePkce, buildAuthorizeUrl, savePendingOAuth } from "../adapters/x.js";

export const channelsAuthedRoutes = new Hono();

channelsAuthedRoutes.post("/:slug/auth/start", async (c) => {
  const slug = c.req.param("slug");
  if (slug !== "x") throw new HTTPException(400, { message: "Phase 0: x only" });
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString("hex");
  await savePendingOAuth(state, verifier);
  const url = buildAuthorizeUrl({ state, code_challenge: challenge });
  return c.json({ authorize_url: url, state });
});
