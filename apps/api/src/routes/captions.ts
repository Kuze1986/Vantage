// routes/captions.ts — POST /v1/captions (3C-2: AI Caption Studio)
// Generates on-voice caption variants from a free-text prompt, using Kuze +
// brand voice + BioLoop weights. Does NOT create a content_piece row.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { generateCaptions } from "../services/kuze.js";
import type { ChannelSlug } from "../services/kuze.js";
import { brandVoiceToPromptString, loadBrandVoice } from "../lib/brand-voice.js";
import { loadProductProfile } from "../lib/product-profile.js";
import { parseProductSlug } from "../lib/products.js";

const bodySchema = z.object({
  prompt:  z.string().min(1).max(500),
  channel: z.string().min(1),
  count:   z.number().int().min(1).max(6).optional(),
  tone:    z.string().optional(),
  product_slug: z.enum(["shift", "keystone", "scripta", "demoforge", "crucible", "vantage"]).optional(),
});

export const captionsRoutes = new Hono();

captionsRoutes.post("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { prompt, channel, count = 3, tone } = parsed.data;
  const ws = c.get("workspaceId");
  const profile = await loadProductProfile(ws);
  const productSlug = parseProductSlug(
    parsed.data.product_slug ?? profile.default_brand_id ?? profile.default_product_id,
  );

  let voice;
  try {
    voice = await loadBrandVoice(ws, productSlug);
  } catch (e) {
    throw new HTTPException(400, { message: e instanceof Error ? e.message : "Configure brand voice first" });
  }
  const brand_voice = brandVoiceToPromptString(voice);

  const captions = await generateCaptions({
    workspace_id: ws,
    prompt,
    channel: channel as ChannelSlug,
    count,
    tone,
    brand_voice,
  });

  return c.json({ captions });
});
