import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { renderForAudit } from "../lib/audit-content.js";
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
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error: pErr } = await sb
    .from("content_pieces")
    .select("id, topic_id, channel_slug, format, content_payload, status, audit_iterations")
    .eq("workspace_id", ws)
    .eq("id", content_piece_id).single();
  if (pErr || !piece) throw new HTTPException(404, { message: "Content piece not found" });
  if (piece.status !== "auditing") {
    throw new HTTPException(400, { message: `Invalid status for audit: ${piece.status}` });
  }

  const format  = piece.format as ContentFormat;
  const payload = piece.content_payload as Record<string, unknown>;
  // Every content-bearing field, not just the first one that happens to exist —
  // hashtags, alt text and on-screen text were previously invisible to the
  // reviewer, which had it failing pieces for omissions they did not have.
  const content = renderForAudit(payload);
  if (!content) throw new HTTPException(400, { message: "Missing content in payload" });

  const { data: voices } = await sb.from("brand_voice").select("*").eq("workspace_id", ws).limit(1);
  const voice = voices?.[0];
  if (!voice) throw new HTTPException(400, { message: "Configure brand voice first" });
  const brandVoiceStr = JSON.stringify({
    name: voice.name,
    description: voice.description,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });

  let iterations = (piece.audit_iterations as number) ?? 0;

  const first = await auditContent({ content, format, brand_voice: brandVoiceStr, workspace_id: ws });

  if (first.verdict === "pass") {
    await sb.from("content_pieces").update({
      status: "approved",
      audit_notes: first.feedback || null,
      audit_iterations: iterations,
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", ws).eq("id", content_piece_id);
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
      audit_category: first.category,
      audit_iterations: iterations,
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", ws).eq("id", content_piece_id);
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
    .select("topic_text, vertical").eq("workspace_id", ws).eq("id", piece.topic_id as string).single();

  const regenTopicText = `${topic?.topic_text ?? ""}\n\nIlita feedback (must address): ${first.feedback}`;
  let gen2: Awaited<ReturnType<typeof generateContent>>;
  try {
    gen2 = await generateContent({
      workspace_id: ws,
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
  // Same full-payload render as the first pass — a regenerated piece must be
  // judged on the same evidence, or the retry can fail for omissions the first
  // attempt was never checked for.
  const newContent = renderForAudit(gen2.content_payload);
  const second = await auditContent({ content: newContent, format: gen2.format, brand_voice: brandVoiceStr, workspace_id: ws });

  const status   = second.verdict === "pass" ? "approved" : "rejected";
  const notes    = second.verdict === "pass" ? second.feedback : `${first.feedback} | ${second.feedback}`;
  const category = second.verdict === "fail" ? second.category : null;

  await sb.from("content_pieces").update({
    status,
    content_payload:  gen2.content_payload,
    audit_notes:      notes,
    audit_category:   category,
    audit_iterations: iterations,
    updated_at:       new Date().toISOString(),
  }).eq("workspace_id", ws).eq("id", content_piece_id);

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
