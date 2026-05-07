import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { auditTweet } from "../services/ilita.js";
import { generateTweet } from "../services/kuze.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
});

export const auditRoutes = new Hono();

auditRoutes.post("/", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }
  const { content_piece_id } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: piece, error: pErr } = await sb
    .schema("vantage")
    .from("content_pieces")
    .select("id, topic_id, channel_slug, content_payload, status, audit_iterations")
    .eq("id", content_piece_id)
    .single();
  if (pErr || !piece) throw new HTTPException(404, { message: "Content piece not found" });
  if (piece.status !== "auditing") {
    throw new HTTPException(400, { message: `Invalid status for audit: ${piece.status}` });
  }

  const payload = piece.content_payload as { body?: string };
  const tweet = payload?.body;
  if (!tweet) throw new HTTPException(400, { message: "Missing tweet body" });

  const { data: topic } = await sb
    .schema("vantage")
    .from("topics")
    .select("topic_text, vertical")
    .eq("id", piece.topic_id as string)
    .single();

  const { data: voices } = await sb.schema("vantage").from("brand_voice").select("*").limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });
  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

  const runIlita = async (text: string) => auditTweet({ tweet: text, brand_voice: brandVoiceStr });

  let currentTweet = tweet;
  let iterations = (piece.audit_iterations as number) ?? 0;
  let lastFeedback = "";

  const first = await runIlita(currentTweet);
  if (first.verdict === "pass") {
    await sb
      .schema("vantage")
      .from("content_pieces")
      .update({
        status: "approved",
        audit_notes: first.feedback || null,
        audit_iterations: iterations,
        updated_at: new Date().toISOString(),
      })
      .eq("id", content_piece_id);
    await logActivity({
      source: "ilita",
      source_type: "agent",
      event_type: "audit_pass",
      summary: `Piece ${content_piece_id} approved`,
      payload: { content_piece_id },
    });
    return c.json({ verdict: "pass", content_piece_id, status: "approved" });
  }

  lastFeedback = first.feedback;
  if (iterations >= 1) {
    await sb
      .schema("vantage")
      .from("content_pieces")
      .update({
        status: "rejected",
        audit_notes: lastFeedback,
        audit_iterations: iterations,
        updated_at: new Date().toISOString(),
      })
      .eq("id", content_piece_id);
    await logActivity({
      source: "ilita",
      source_type: "agent",
      event_type: "audit_reject_final",
      summary: lastFeedback.slice(0, 300),
      payload: { content_piece_id },
    });
    return c.json({ verdict: "fail", content_piece_id, status: "rejected", feedback: lastFeedback });
  }

  const regenPrompt = `${topic?.topic_text ?? ""}\n\nIlita feedback (must address): ${lastFeedback}`;
  let newBody: string;
  try {
    const gen = await generateTweet({
      topic_text: regenPrompt,
      vertical: (topic?.vertical as string | null) ?? null,
      brand_voice: brandVoiceStr,
    });
    newBody = gen.body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity({
      source: "kuze",
      source_type: "agent",
      event_type: "regenerate_error",
      summary: msg,
      payload: { content_piece_id },
    });
    throw new HTTPException(500, { message: msg });
  }

  currentTweet = newBody;
  iterations = 1;
  const second = await runIlita(currentTweet);

  const status = second.verdict === "pass" ? "approved" : "rejected";
  const notes = second.verdict === "pass" ? second.feedback : `${lastFeedback} | ${second.feedback}`;

  await sb
    .schema("vantage")
    .from("content_pieces")
    .update({
      status,
      content_payload: { body: newBody, metadata: { regen: true } },
      audit_notes: notes,
      audit_iterations: iterations,
      updated_at: new Date().toISOString(),
    })
    .eq("id", content_piece_id);

  await logActivity({
    source: "ilita",
    source_type: "agent",
    event_type: status === "approved" ? "audit_pass_after_regen" : "audit_reject_after_regen",
    summary: notes.slice(0, 300),
    payload: { content_piece_id, iterations },
  });

  return c.json({
    verdict: second.verdict,
    content_piece_id,
    status,
    feedback: second.verdict === "fail" ? second.feedback : undefined,
  });
});
