/**
 * Media readiness gate for schedule / publish / cadence.
 * Pieces with pending or failed media (or social-kit needs without an image)
 * are blocked unless force=true (which stamps content_payload.force_media).
 */

export type MediaGatePiece = {
  media_status?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  content_payload?: Record<string, unknown> | null;
};

export function isMediaForced(piece: MediaGatePiece): boolean {
  const payload = piece.content_payload;
  return Boolean(payload && typeof payload === "object" && payload.force_media === true);
}

export function isMediaGated(piece: MediaGatePiece): boolean {
  if (isMediaForced(piece)) return false;

  const status = piece.media_status ?? "none";
  if (status === "pending" || status === "failed") return true;

  const payload = piece.content_payload;
  if (payload && typeof payload === "object" && payload.needs_social_kit === true) {
    const hasImage =
      (typeof piece.image_url === "string" && piece.image_url.length > 0) ||
      (typeof payload.image_url === "string" && payload.image_url.length > 0);
    if (!hasImage) return true;
  }

  return false;
}

export function mediaGateReason(piece: MediaGatePiece): string {
  const status = piece.media_status ?? "none";
  if (status === "pending") return "Media is still pending (DemoForge / upload)";
  if (status === "failed") return "Media generation failed — fix media or use force";
  const payload = piece.content_payload;
  if (payload && typeof payload === "object" && payload.needs_social_kit === true) {
    return "Social Kit graphic required — attach an image or use force";
  }
  return "Media not ready";
}

/** Throws Error with a clear message when gated and not forced. */
export function assertMediaReady(piece: MediaGatePiece, opts?: { force?: boolean }): void {
  if (opts?.force || isMediaForced(piece)) return;
  if (isMediaGated(piece)) {
    throw new Error(mediaGateReason(piece));
  }
}

/** Merge force_media into a content_payload copy. */
export function withForceMedia(
  contentPayload: Record<string, unknown> | null | undefined,
  force: boolean,
): Record<string, unknown> {
  const payload =
    contentPayload && typeof contentPayload === "object" && !Array.isArray(contentPayload)
      ? { ...contentPayload }
      : {};
  if (force) payload.force_media = true;
  return payload;
}
