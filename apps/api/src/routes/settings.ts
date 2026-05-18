import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { loadSettings, patchSettings } from "../lib/settings.js";

export const settingsRoutes = new Hono();

// GET /v1/settings — return all current settings
settingsRoutes.get("/", async (c) => {
  const settings = await loadSettings();
  return c.json({ settings });
});

const patchSchema = z.object({
  dedup_days:       z.number().int().min(1).max(365).optional(),
  scripta_enabled:  z.boolean().optional(),
  bioloop_enabled:  z.boolean().optional(),
  active_verticals: z.array(z.string()).optional(),
});

// PATCH /v1/settings — update one or more settings
settingsRoutes.patch("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  await patchSettings(parsed.data);
  const settings = await loadSettings();
  return c.json({ ok: true, settings });
});
