import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { generateContent } from "../services/kuze.js";
import { generateImage } from "../services/imageGen.js";
import { tagUrls } from "../lib/utm.js";
import type { ChannelSlug } from "../services/kuze.js";

const bodySchema = z.object({
  topic_id:       z.string().uuid(),
  subreddit:      z.string().optional(),
  generate_image: z.boolean().optional(),
  variants:       z.number().int().min(1).max(3).optional(), // A/B variant count
});

export const generateRoutes = new Hono();

// Image-supporting channels (visuals make sense)
const IMAGE_CHANNELS = new Set(["x", "linkedin", "instagram", "facebook", "tiktok"]);

generateRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel") as ChannelSlug;

  const json   = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { topic_id, subreddit, generate_image, variants = 1 } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: topic, error: tErr } = await sb
    .from("topics")
    .select("id, topic_text, vertical, used_at")
    .eq("id", topic_id).single();
  if (tErr || !topic) throw new HTTPException(404, { message: "Topic not found" });

  const { data: voices } = await sb.from("brand_voice").select("*").limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });

  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

  // For A/B variants, all pieces in this batch share a variant_group_id
  const variantGroupId = variants > 1 ? randomUUID() : null;
  const createdPieces: Array<{ content_piece_id: string; format: string; status: string }> = [];

  for (let i = 0; i < variants; i++) {
    let gen: Awaited<ReturnType<typeof generateContent>>;
    try {
      gen = await generateContent({
        channel,
        topic_text:  topic.topic_text as string,
        vertical:    (topic.vertical as string | null) ?? null,
        brand_voice: brandVoiceStr,
        extras: { subreddit },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logActivity({
        source: "kuze", source_type: "agent",
        event_type: "generate_error",
        summary: msg,
        payload: { topic_id, channel, variant_index: i },
      });
      // On single-variant requests propagate immediately; on multi-variant continue
      if (variants === 1) throw new HTTPException(500, { message: msg });
      continue;
    }

    // Insert piece first so we have the ID for UTM tagging
    const { data: piece, error: pErr } = await sb
      .from("content_pieces")
      .insert({
        topic_id,
        channel_slug:     channel,
        format:           gen.format,
        content_payload:  gen.content_payload,
        status:           "auditing",
        audit_iterations: 0,
        ...(variantGroupId ? { variant_group_id: variantGroupId } : {}),
      })
      .select("id").single();

    if (pErr || !piece) {
      await logActivity({
        source: "kuze", source_type: "agent",
        event_type: "insert_error",
        summary: pErr?.message ?? "unknown",
        payload: { topic_id, channel },
      });
      if (variants === 1) throw new HTTPException(500, { message: pErr?.message ?? "insert failed" });
      continue;
    }

    // Apply UTM tags now that we have piece.id
    const taggedPayload = { ...gen.content_payload };
    for (const [k, v] of Object.entries(taggedPayload)) {
      if (typeof v === "string") taggedPayload[k] = tagUrls(v, channel, piece.id);
    }

    // Optionally generate an image via DALL-E 3
    let imageUrl: string | null = null;
    if (generate_image && IMAGE_CHANNELS.has(channel)) {
      try {
        imageUrl = await generateImage({
          topic_text: topic.topic_text as string,
          vertical:   (topic.vertical as string | null) ?? null,
          channel,
          brand_name: (voice.name as string | undefined) ?? "NEXUS",
        });
        taggedPayload.image_url = imageUrl;
      } catch (imgErr) {
        const imgMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
        await logActivity({
          source: "kuze", source_type: "agent",
          event_type: "image_generate_error",
          summary: imgMsg,
          payload: { content_piece_id: piece.id, channel },
        });
        // Non-fatal — piece continues without image
      }
    }

    await sb.from("content_pieces")
      .update({
        content_payload: taggedPayload,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      })
      .eq("id", piece.id);

    createdPieces.push({ content_piece_id: piece.id, format: gen.format, status: "auditing" });

    await logActivity({
      source: "kuze", source_type: "agent",
      event_type: "generated",
      summary: `${gen.format} draft for topic ${topic_id} on ${channel}${variantGroupId ? ` (variant ${i + 1}/${variants})` : ""}`,
      payload: {
        content_piece_id: piece.id, topic_id, channel, format: gen.format,
        ...(variantGroupId ? { variant_group_id: variantGroupId, variant_index: i } : {}),
        ...(imageUrl ? { has_image: true } : {}),
      },
      drill_uri: `/queue?piece=${piece.id}`,
    });
  }

  if (!topic.used_at) {
    await sb.from("topics")
      .update({ used_at: new Date().toISOString() }).eq("id", topic_id);
  }

  if (createdPieces.length === 0) {
    throw new HTTPException(500, { message: "All variant generations failed" });
  }

  // Single variant → backward-compatible response shape
  if (variants === 1) {
    const p = createdPieces[0];
    return c.json({ content_piece_id: p.content_piece_id, format: p.format, status: p.status });
  }

  // Multi-variant → new shape
  return c.json({ variant_group_id: variantGroupId, pieces: createdPieces });
});
