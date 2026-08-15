import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { loadSettings, patchSettings } from "../lib/settings.js";
import { listLLMProviders } from "../lib/llm-providers/index.js";
import { loadProductProfile, patchProductProfile } from "../lib/product-profile.js";
import { countPoolEntries, parsePool } from "../lib/llm-pool.js";
import { resolveChain } from "../lib/llm.js";

export const settingsRoutes = new Hono();

// GET /v1/settings — return all current settings
settingsRoutes.get("/", async (c) => {
  const settings = await loadSettings(c.get("workspaceId"));
  return c.json({ settings });
});

// GET /v1/settings/product-profile — workspace default product (Shift-first)
settingsRoutes.get("/product-profile", async (c) => {
  const profile = await loadProductProfile(c.get("workspaceId"));
  return c.json({ profile });
});

const productProfileSchema = z.object({
  default_product_id: z.string().min(1).optional(),
  product_base_url: z.string().url().optional(),
  default_brand_id: z.string().min(1).optional(),
  default_demoforge_template_id: z.string().optional(),
  default_brand_kit_id: z.string().optional(),
  // Empty string clears it — unlike the other fields there's no fallback value,
  // so "no bio link configured" has to be expressible.
  bio_link_url: z.union([z.string().url(), z.literal("")]).optional(),
});

settingsRoutes.patch("/product-profile", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = productProfileSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  const profile = await patchProductProfile(c.get("workspaceId"), parsed.data);
  return c.json({ ok: true, profile });
});

// GET /v1/settings/llm-providers — list providers, availability, and model options
settingsRoutes.get("/llm-providers", (c) => {
  const providers = listLLMProviders().map((p) => ({
    name:            p.name,
    displayName:     p.displayName,
    available:       p.available,
    defaultModel:    p.defaultModel,
    candidateModels: [...p.candidateModels],
  }));
  return c.json({ providers });
});

// GET /v1/settings/llm-resolution — the chain each task actually resolves to.
// Makes "which model am I on right now" a fact on screen rather than a guess.
settingsRoutes.get("/llm-resolution", async (c) => {
  const ws = c.get("workspaceId");
  const [generate, audit] = await Promise.all([
    resolveChain("generate", ws),
    resolveChain("audit", ws),
  ]);
  return c.json({ generate, audit });
});

/**
 * Provider choice: "" (inherit), a bare provider name, or a failover pool
 * ("openai:gpt-4o,anthropic"). Validated by parsing rather than by an enum — the old
 * enum accepted "gemini"/"kimi" whether or not they existed, so a user could save a
 * value that silently did nothing. Requiring every entry to parse makes it honest.
 */
const providerChoice = z
  .string()
  .max(200)
  .refine((v) => v === "" || parsePool(v).length === countPoolEntries(v), {
    message:
      "must be a comma-separated list of `provider` or `provider:model` using known providers",
  });

/** Any model id the provider accepts — deliberately not a whitelist. */
const modelChoice = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9._:\/-]*$/, "invalid model id");

const patchSchema = z.object({
  dedup_days:            z.number().int().min(1).max(365).optional(),
  scripta_enabled:       z.boolean().optional(),
  bioloop_enabled:       z.boolean().optional(),
  active_verticals:      z.array(z.string()).optional(),
  llm_provider_generate: providerChoice.optional(),
  llm_provider_audit:    providerChoice.optional(),
  llm_model_generate:    modelChoice.optional(),
  llm_model_audit:       modelChoice.optional(),
  llm_failover_enabled:  z.boolean().optional(),
  generator_instructions: z.string().max(6000).optional(),
  auditor_instructions:   z.string().max(6000).optional(),
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
