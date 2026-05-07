import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

/** Phase 0: mark piece queued with optional scheduled time (default now). */
export async function scheduleContentPiece(
  contentPieceId: string,
  scheduledForIso?: string,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const scheduledFor = scheduledForIso ?? new Date().toISOString();
  const { data: piece, error: loadErr } = await sb
    .schema("vantage")
    .from("content_pieces")
    .select("id, status")
    .eq("id", contentPieceId)
    .single();
  if (loadErr || !piece) throw new Error("Content piece not found");
  if (piece.status !== "approved") {
    throw new Error(`Can only schedule approved pieces, got ${piece.status}`);
  }

  const { error } = await sb
    .schema("vantage")
    .from("content_pieces")
    .update({
      status: "queued",
      scheduled_for: scheduledFor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contentPieceId);

  if (error) throw new Error(error.message);

  await logActivity({
    source: "scheduler",
    source_type: "system",
    event_type: "scheduled",
    summary: `Content piece ${contentPieceId} queued`,
    payload: { content_piece_id: contentPieceId, scheduled_for: scheduledFor },
  });
}
