import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { generateContent } from "../services/kuze.js";
import { tagUrls } from "../lib/utm.js";
import type { ChannelSlug } from "../services/kuze.js";

const bodySchema = z.object({
  topic_id:       z.string().uuid(),
  subreddit:      z.string().optional(),
  generate_image: z.boolean().optional(),
});

export const generateRoutes = new Hono();

generateRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel") as ChannelSlug;

  const json   = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { topic_id, subreddit } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: topic, error: tErr } = await sb
    .schema("vantage").from("topics")
    .select("id, topic_text, vertical, used_at")
    .eq("id", topic_id).single();
  if (tErr || !topic) throw new HTTPException(404, { message: "Topic not found" });

  const { data: voices } = await sb.schema("vantage").from("brand_voice").select("*").limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });

  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

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
      payload: { topic_id, channel },
    });
    throw new HTTPException(500, { message: msg });
  }

  // Insert piece first so we have the ID for UTM tagging
  const { data: piece, error: pErr } = await sb
    .schema("vantage").from("content_pieces")
    .insert({
      topic_id,
      channel_slug:     channel,
      format:           gen.format,
      content_payload:  gen.content_payload,
      status:           "auditing",
      audit_iterations: 0,
    })
    .select("id").single();

  if (pErr || !piece) {
    await logActivity({
      source: "kuze", source_type: "agent",
      event_type: "insert_error",
      summary: pErr?.message ?? "unknown",
      payload: { topic_id, channel },
    });
    throw new HTTPException(500, { message: pErr?.message ?? "insert failed" });
  }

  // Apply UTM tags now that we have piece.id
  const taggedPayload = { ...gen.content_payload };
  for (const [k, v] of Object.entries(taggedPayload)) {
    if (typeof v === "string") taggedPayload[k] = tagUrls(v, channel, piece.id);
  }
  await sb.schema("vantage").from("content_pieces")
    .update({ content_payload: taggedPayload }).eq("id", piece.id);

  if (!topic.used_at) {
    await sb.schema("vantage").from("topics")
      .update({ used_at: new Date().toISOString() }).eq("id", topic_id);
  }

  await logActivity({
    source: "kuze", source_type: "agent",
    event_type: "generated",
    summary: `${gen.format} draft for topic ${topic_id} on ${channel}`,
    payload: { content_piece_id: piece.id, topic_id, channel, format: gen.format },
    drill_uri: `/queue?piece=${piece.id}`,
  });

  return c.json({ content_piece_id: piece.id, format: gen.format, status: "auditing" });
});
