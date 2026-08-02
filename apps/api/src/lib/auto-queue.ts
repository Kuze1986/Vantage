/**
 * Autopilot auto-queue: when a piece is approved, has scheduled_for, and media
 * is ready (none/ready) — or force_media is set — flip to queued so cadence picks it up.
 */

import { getSupabaseAdmin } from "./supabase.js";
import { logActivity } from "./activity.js";
import { isMediaForced, isMediaGated } from "./media-gate.js";

export type AutoQueuePiece = {
  id: string;
  status: string;
  scheduled_for?: string | null;
  media_status?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  content_payload?: Record<string, unknown> | null;
};

/**
 * Returns true if the piece should enter the cadence queue now.
 * Requires: status=approved, scheduled_for set, media not gated (or forced).
 */
export function shouldAutoQueue(piece: AutoQueuePiece): boolean {
  if (piece.status !== "approved") return false;
  if (!piece.scheduled_for) return false;
  if (isMediaForced(piece)) return true;
  const media = piece.media_status ?? "none";
  if (media !== "none" && media !== "ready") return false;
  return !isMediaGated(piece);
}

/**
 * If eligible, set status=queued. Returns whether the update ran.
 */
export async function maybeAutoQueuePiece(
  workspaceId: string,
  contentPieceId: string,
): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data: piece, error } = await sb
    .from("content_pieces")
    .select("id, status, scheduled_for, media_status, image_url, video_url, content_payload")
    .eq("workspace_id", workspaceId)
    .eq("id", contentPieceId)
    .maybeSingle();
  if (error || !piece) return false;

  const row = piece as AutoQueuePiece;
  if (!shouldAutoQueue(row)) return false;

  const { error: updErr } = await sb
    .from("content_pieces")
    .update({
      status: "queued",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", contentPieceId)
    .eq("status", "approved");
  if (updErr) {
    console.warn(`[auto-queue] failed for ${contentPieceId}:`, updErr.message);
    return false;
  }

  await logActivity({
    source: "scheduler",
    source_type: "system",
    event_type: "auto_queued",
    summary: `Content piece ${contentPieceId} auto-queued for ${row.scheduled_for}`,
    payload: {
      content_piece_id: contentPieceId,
      scheduled_for: row.scheduled_for,
      media_status: row.media_status,
    },
    workspace_id: workspaceId,
  }).catch(() => {});

  return true;
}

/**
 * Resolve initial launch status after audit pass:
 * - media pending → approved (wait for DemoForge)
 * - media none/ready → queued
 */
export function launchStatusForMedia(
  mediaStatus: "none" | "pending" | "ready" | "failed",
): "approved" | "queued" {
  if (mediaStatus === "none" || mediaStatus === "ready") return "queued";
  return "approved";
}
