/**
 * Media gallery — one browsable index of every asset a workspace has produced.
 *
 * Media is scattered across five places with no single view of it: piece hero
 * images and videos, carousel slides and OG cards inside `content_payload`,
 * DemoForge renders plus their thumbnails and extracted keyframes, brand kit
 * logos, and intro/outro clips.
 *
 * **The index is built from database rows, never from a Storage listing.**
 * Storage paths are not uniformly workspace-namespaced — DemoForge writes to
 * `demoforge/<format>/<job_id>.mp4` with no workspace segment — so ownership
 * cannot be read off the path. Querying the tables keeps every result scoped by
 * construction: each query filters on `workspace_id`, so a caller can only ever
 * see their own assets regardless of how the bucket is laid out.
 */
import { parseCarouselUrls } from "./carousel.js";

export type MediaKind = "image" | "video";

/** Where the asset came from — drives the filter chips and the row action. */
export type MediaSource = "piece" | "demoforge" | "brand_kit" | "clip";

export type MediaItem = {
  /** Stable within a response; composed from source + owner + role so it survives refetches. */
  id: string;
  kind: MediaKind;
  url: string;
  /** Poster for videos, when one is known. Null for images and un-thumbnailed renders. */
  thumbnail_url: string | null;
  label: string;
  source: MediaSource;
  /** Set when the asset hangs off a content piece — powers "Open piece". */
  piece_id: string | null;
  /** Set when the asset hangs off a DemoForge job — powers "Open job". */
  job_id: string | null;
  created_at: string | null;
};

/**
 * Per-table fetch cap. The gallery shows the most recent assets rather than
 * paging exhaustively through history; with the merge-then-slice approach below
 * an unbounded fetch would mean pulling every row of five tables to render one
 * screen. Callers page within this window.
 */
export const GALLERY_SCAN_LIMIT = 500;

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/** Videos are identified by extension; everything else in these tables is an image. */
export function inferKind(url: string): MediaKind {
  return VIDEO_EXT.test(url) ? "video" : "image";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** `content_payload.mode_stills` is `[{ mode, url }]` written by the product-still pipeline. */
function parseModeStills(payload: Record<string, unknown> | null | undefined): Array<{ mode: string; url: string }> {
  const raw = payload?.mode_stills;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ mode: string; url: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = str(rec.url);
    if (!url) continue;
    out.push({ mode: str(rec.mode) ?? "still", url });
  }
  return out;
}

export type PieceRow = {
  id: string;
  channel_slug?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  content_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type JobRow = {
  id: string;
  content_piece_id?: string | null;
  target_format?: string | null;
  output_url?: string | null;
  thumbnail_url?: string | null;
  extracted_frames?: unknown;
  created_at?: string | null;
};

export type BrandKitRow = { id: string; name?: string | null; logo_url?: string | null; created_at?: string | null };
export type ClipRow = {
  id: string;
  name?: string | null;
  type?: string | null;
  preview_url?: string | null;
  storage_path?: string | null;
  created_at?: string | null;
};

/** Flatten one content piece into every distinct asset hanging off it. */
export function itemsFromPiece(piece: PieceRow): MediaItem[] {
  const items: MediaItem[] = [];
  const payload = piece.content_payload ?? null;
  const channel = piece.channel_slug ?? "piece";
  const at = piece.created_at ?? null;
  const video = str(piece.video_url);
  const hero = str(piece.image_url);

  const push = (role: string, url: string, label: string, kind?: MediaKind, thumb?: string | null) => {
    items.push({
      id: `piece:${piece.id}:${role}`,
      kind: kind ?? inferKind(url),
      url,
      thumbnail_url: thumb ?? null,
      label,
      source: "piece",
      piece_id: piece.id,
      job_id: null,
      created_at: at,
    });
  };

  // The rendered video is the headline asset when present; the hero image is its poster.
  if (video) push("video", video, `${channel} video`, "video", hero);
  if (hero) push("hero", hero, `${channel} hero`, "image");

  const og = str((payload ?? {}).og_image_url);
  if (og && og !== hero) push("og", og, `${channel} share card`, "image");

  parseCarouselUrls(payload).forEach((url, i) => {
    // Slide 01 is mirrored onto image_url by the builder — don't list it twice.
    if (url === hero) return;
    push(`carousel:${i}`, url, `${channel} carousel ${String(i + 1).padStart(2, "0")}`, "image");
  });

  parseModeStills(payload).forEach(({ mode, url }) => {
    if (url === hero) return;
    push(`still:${mode}`, url, `${mode} still`, "image");
  });

  return items;
}

/** Flatten one DemoForge job into its render, cover, and extracted keyframes. */
export function itemsFromJob(job: JobRow): MediaItem[] {
  const items: MediaItem[] = [];
  const at = job.created_at ?? null;
  const fmt = job.target_format ?? "render";
  const thumb = str(job.thumbnail_url);

  const push = (role: string, url: string, label: string, kind?: MediaKind, poster?: string | null) => {
    items.push({
      id: `job:${job.id}:${role}`,
      kind: kind ?? inferKind(url),
      url,
      thumbnail_url: poster ?? null,
      label,
      source: "demoforge",
      piece_id: job.content_piece_id ?? null,
      job_id: job.id,
      created_at: at,
    });
  };

  const out = str(job.output_url);
  if (out) push("output", out, `${fmt} render`, "video", thumb);
  if (thumb) push("thumbnail", thumb, `${fmt} cover`, "image");

  if (Array.isArray(job.extracted_frames)) {
    job.extracted_frames.forEach((raw, i) => {
      // Frames are stored either as bare URLs or as { url } records.
      const url = typeof raw === "string" ? str(raw) : str((raw as Record<string, unknown> | null)?.url);
      if (!url || url === thumb) return;
      push(`frame:${i}`, url, `${fmt} frame ${i + 1}`, "image");
    });
  }

  return items;
}

export function itemsFromBrandKit(kit: BrandKitRow): MediaItem[] {
  const logo = str(kit.logo_url);
  if (!logo) return [];
  return [{
    id: `brand_kit:${kit.id}:logo`,
    kind: "image",
    url: logo,
    thumbnail_url: null,
    label: `${kit.name ?? "Brand kit"} logo`,
    source: "brand_kit",
    piece_id: null,
    job_id: null,
    created_at: kit.created_at ?? null,
  }];
}

export function itemsFromClip(clip: ClipRow, publicUrlFor: (path: string) => string): MediaItem[] {
  // Clips store a Storage path rather than a URL; the optional preview is a GIF.
  const path = str(clip.storage_path);
  const preview = str(clip.preview_url);
  if (!path && !preview) return [];
  const url = path ? publicUrlFor(path) : preview!;
  return [{
    id: `clip:${clip.id}`,
    kind: path ? inferKind(url) : "image",
    url,
    thumbnail_url: preview,
    label: `${clip.name ?? "Clip"}${clip.type ? ` (${clip.type})` : ""}`,
    source: "clip",
    piece_id: null,
    job_id: null,
    created_at: clip.created_at ?? null,
  }];
}

/**
 * Merge, filter and page. Newest first; items with no timestamp sort last rather
 * than jumping to the top, so an undated brand kit logo can't outrank a fresh render.
 */
export function assembleGallery(
  all: MediaItem[],
  opts: { source?: string | null; kind?: string | null; limit: number; offset: number },
): { items: MediaItem[]; total: number; next_offset: number | null } {
  let filtered = all;
  if (opts.source) filtered = filtered.filter((i) => i.source === opts.source);
  if (opts.kind) filtered = filtered.filter((i) => i.kind === opts.kind);

  // De-dupe by URL: the same object can legitimately be reachable from two
  // owners (a job's cover is also the linked piece's hero). Keep the first,
  // which after sorting is the most recent / most specific.
  const sorted = [...filtered].sort((a, b) => {
    if (!a.created_at && !b.created_at) return 0;
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    return b.created_at.localeCompare(a.created_at);
  });

  const seen = new Set<string>();
  const deduped = sorted.filter((i) => {
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });

  const page = deduped.slice(opts.offset, opts.offset + opts.limit);
  const nextOffset = opts.offset + page.length;
  return {
    items: page,
    total: deduped.length,
    next_offset: nextOffset < deduped.length ? nextOffset : null,
  };
}
