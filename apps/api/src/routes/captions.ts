// routes/captions.ts — POST /v1/captions (3C-2: AI Caption Studio)
// Generates on-voice caption variants from a free-text prompt, using Kuze +
// brand voice + BioLoop weights. Does NOT create a content_piece row.

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { generateCaptions } from "../services/kuze.js";
import type { ChannelSlug } from "../services/kuze.js";

const bodySchema = z.object({
  prompt:  z.string().min(1).max(500),
  channel: z.string().min(1),
  count:   z.number().int().min(1).max(6).optional(),
  tone:    z.string().optional(),
});

export const captionsRoutes = new Hono();

captionsRoutes.post("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { prompt, channel, count = 3, tone } = parsed.data;
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: voices } = await sb.from("brand_voice").select("*").eq("workspace_id", ws).limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });

  const brand_voice = JSON.stringify({
    name:             voice.name,
    description:      voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics:       voice.off_topics,
  });

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
