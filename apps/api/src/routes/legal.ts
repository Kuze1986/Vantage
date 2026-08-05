import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { isLegalSlug, updateLegalPage } from "../lib/legal-pages.js";

// Editing only — public reads are mounted directly on the unauthenticated
// app in index.ts (GET /v1/legal/:slug) so ToS/Privacy work without login.
export const legalRoutes = new Hono();

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
});

legalRoutes.patch("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isLegalSlug(slug)) throw new HTTPException(404, { message: "Unknown legal page" });
  if (c.get("workspaceRole") !== "owner") {
    throw new HTTPException(403, { message: "Only the workspace owner can edit legal pages" });
  }
  const json = await c.req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  const page = await updateLegalPage(slug, parsed.data, c.get("user").id);
  return c.json({ page });
});
