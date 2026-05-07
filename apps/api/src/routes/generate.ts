import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { generateTweet } from "../services/kuze.js";
import { auditTweet } from "../services/ilita.js";

const bodySchema = z.object({
  topic_id: z.string().uuid(),
});

export const generateRoutes = new Hono();

generateRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "x") {
    throw new HTTPException(400, { message: "Phase 0 supports channel x only" });
  }
  const json = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  const { topic_id } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: topic, error: tErr } = await sb
    .schema("vantage")
    .from("topics")
    .select("id, topic_text, vertical, used_at")
    .eq("id", topic_id)
    .single();
  if (tErr || !topic) throw new HTTPException(404, { message: "Topic not found" });

  const { data: voices, error: vErr } = await sb.schema("vantage").from("brand_voice").select("*").limit(1);
  if (vErr) throw new HTTPException(500, { message: vErr.message });
  const voice = voices?.[0];
  if (!voice) {
    throw new HTTPException(400, { message: "Configure brand voice first" });
  }

  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

  let bodyText: string;
  try {
    const gen = await generateTweet({
      topic_text: topic.topic_text as string,
      vertical: (topic.vertical as string | null) ?? null,
      brand_voice: brandVoiceStr,
    });
    bodyText = gen.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity({
      source: "kuze",
      source_type: "agent",
      event_type: "generate_error",
      summary: msg,
      payload: { topic_id },
    });
    throw new HTTPException(500, { message: msg });
  }

  const { data: piece, error: pErr } = await sb
    .schema("vantage")
    .from("content_pieces")
    .insert({
      topic_id,
      channel_slug: "x",
      format: "tweet",
      content_payload: { body: bodyText, metadata: {} },
      status: "auditing",
      audit_iterations: 0,
    })
    .select("id")
    .single();

  if (pErr || !piece) {
    await logActivity({
      source: "kuze",
      source_type: "agent",
      event_type: "insert_error",
      summary: pErr?.message ?? "unknown",
      payload: { topic_id },
    });
    throw new HTTPException(500, { message: pErr?.message ?? "insert failed" });
  }

  if (!topic.used_at) {
    await sb
      .schema("vantage")
      .from("topics")
      .update({ used_at: new Date().toISOString() })
      .eq("id", topic_id);
  }

  await logActivity({
    source: "kuze",
    source_type: "agent",
    event_type: "generated",
    summary: `Tweet draft for topic ${topic_id}`,
    payload: { content_piece_id: piece.id, topic_id },
    drill_uri: `/queue?piece=${piece.id}`,
  });

  return c.json({ content_piece_id: piece.id, status: "auditing" });
});
