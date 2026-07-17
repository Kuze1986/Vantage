import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { loadSettings, patchSettings } from "../lib/settings.js";
import { listLLMProviders } from "../lib/llm-providers/index.js";

export const settingsRoutes = new Hono();

// GET /v1/settings — return all current settings
settingsRoutes.get("/", async (c) => {
  const settings = await loadSettings(c.get("workspaceId"));
  return c.json({ settings });
});

// GET /v1/settings/llm-providers — list providers and whether each is configured
settingsRoutes.get("/llm-providers", (c) => {
  const providers = listLLMProviders().map((p) => ({
    name:        p.name,
    displayName: p.displayName,
    available:   p.available,
  }));
  return c.json({ providers });
});

// "" is allowed and means "inherit the env default".
const providerChoice = z.enum(["anthropic", "openai", "grok", ""]);

const patchSchema = z.object({
  dedup_days:            z.number().int().min(1).max(365).optional(),
  scripta_enabled:       z.boolean().optional(),
  bioloop_enabled:       z.boolean().optional(),
  active_verticals:      z.array(z.string()).optional(),
  llm_provider_generate: providerChoice.optional(),
  llm_provider_audit:    providerChoice.optional(),
});

// PATCH /v1/settings — update one or more settings
settingsRoutes.patch("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const ws = c.get("workspaceId");
  await patchSettings(ws, parsed.data);
  const settings = await loadSettings(ws);
  return c.json({ ok: true, settings });
});
