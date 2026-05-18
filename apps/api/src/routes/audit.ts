import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { auditContent } from "../services/ilita.js";
import { generateContent } from "../services/kuze.js";
import type { ChannelSlug } from "../services/kuze.js";
import type { ContentFormat } from "@vantage/prompts";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
});

export const auditRoutes = new Hono();

auditRoutes.post("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { content_piece_id } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: piece, error: pErr } = await sb
    .from("content_pieces")
    .select("id, topic_id, channel_slug, format, content_payload, status, audit_iterations")
    .eq("id", content_piece_id).single();
  if (pErr || !piece) throw new HTTPException(404, { message: "Content piece not found" });
  if (piece.status !== "auditing") {
    throw new HTTPException(400, { message: `Invalid status for audit: ${piece.status}` });
  }

  const format  = piece.format as ContentFormat;
  const payload = piece.content_payload as Record<string, unknown>;
  const content = String(payload.body ?? payload.text ?? payload.hook ?? payload.title ?? JSON.stringify(payload));
  if (!content) throw new HTTPException(400, { message: "Missing content in payload" });

  const { data: voices } = await sb.from("brand_voice").select("*").limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });
  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

  let iterations = (piece.audit_iterations as number) ?? 0;

  const first = await auditContent({ content, format, brand_voice: brandVoiceStr });

  if (first.verdict === "pass") {
    await sb.from("content_pieces").update({
      status: "approved",
      audit_notes: first.feedback || null,
      audit_iterations: iterations,
      updated_at: new Date().toISOString(),
    }).eq("id", content_piece_id);
    await logActivity({
      source: "ilita", source_type: "agent",
      event_type: "audit_pass",
      summary: `Piece ${content_piece_id} approved`,
      payload: { content_piece_id },
    });
    return c.json({ verdict: "pass", content_piece_id, status: "approved" });
  }

  // First pass failed — if already at max iterations, reject
  if (iterations >= 1) {
    await sb.from("content_pieces").update({
      status: "rejected",
      audit_notes: first.feedback,
      audit_iterations: iterations,
      updated_at: new Date().toISOString(),
    }).eq("id", content_piece_id);
    await logActivity({
      source: "ilita", source_type: "agent",
      event_type: "audit_reject_final",
      summary: first.feedback.slice(0, 300),
      payload: { content_piece_id },
    });
    return c.json({ verdict: "fail", content_piece_id, status: "rejected", feedback: first.feedback });
  }

  // Regen with feedback
  const { data: topic } = await sb.from("topics")
    .select("topic_text, vertical").eq("id", piece.topic_id as string).single();

  const regenTopicText = `${topic?.topic_text ?? ""}\n\nIlita feedback (must address): ${first.feedback}`;
  let gen2: Awaited<ReturnType<typeof generateContent>>;
  try {
    gen2 = await generateContent({
      channel:     piece.channel_slug as ChannelSlug,
      topic_text:  regenTopicText,
      vertical:    (topic?.vertical as string | null) ?? null,
      brand_voice: brandVoiceStr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity({
      source: "kuze", source_type: "agent",
      event_type: "regenerate_error",
      summary: msg,
      payload: { content_piece_id },
    });
    throw new HTTPException(500, { message: msg });
  }

  iterations = 1;
  const newContent = String(
    gen2.content_payload.body ?? gen2.content_payload.text ??
    gen2.content_payload.hook ?? gen2.content_payload.title ?? ""
  );
  const second = await auditContent({ content: newContent, format: gen2.format, brand_voice: brandVoiceStr });

  const status = second.verdict === "pass" ? "approved" : "rejected";
  const notes  = second.verdict === "pass" ? second.feedback : `${first.feedback} | ${second.feedback}`;

  await sb.from("content_pieces").update({
    status,
    content_payload:  gen2.content_payload,
    audit_notes:      notes,
    audit_iterations: iterations,
    updated_at:       new Date().toISOString(),
  }).eq("id", content_piece_id);

  await logActivity({
    source: "ilita", source_type: "agent",
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
