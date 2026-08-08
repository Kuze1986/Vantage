/**
 * Authenticated media uploads via service role.
 * Browser Storage upserts need INSERT+UPDATE RLS; creative tools (OG / quote cards)
 * go through this route so uploads work even when client policies are incomplete.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import {
  assembleGallery,
  itemsFromBrandKit,
  itemsFromClip,
  itemsFromJob,
  itemsFromPiece,
  GALLERY_SCAN_LIMIT,
  type MediaItem,
} from "../lib/media-gallery.js";

export const mediaRoutes = new Hono();

const ALLOWED_PREFIXES = ["og/", "quotes/", "thumbnails/", "creative/"] as const;

const uploadSchema = z.object({
  path: z.string().min(3).max(240),
  data_url: z.string().min(1),
});

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new HTTPException(400, { message: "data_url must be a base64 data URL" });
  const contentType = m[1]!.toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new HTTPException(400, { message: "Upload must be an image data URL" });
  }
  const ext =
    contentType.includes("png") ? "png"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : "jpg";
  const buffer = Buffer.from(m[2]!, "base64");
  if (buffer.length > 8 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Image must be 8MB or smaller" });
  }
  return { buffer, contentType, ext };
}

function sanitizePath(raw: string, ext: string, workspaceId: string): string {
  const cleaned = raw.replace(/^\/+/, "").replace(/\.\./g, "");
  if (!ALLOWED_PREFIXES.some((p) => cleaned.startsWith(p))) {
    throw new HTTPException(400, {
      message: `path must start with one of: ${ALLOWED_PREFIXES.join(", ")}`,
    });
  }
  const withExt =
    cleaned.endsWith(".png") || cleaned.endsWith(".jpg") || cleaned.endsWith(".jpeg") || cleaned.endsWith(".webp")
      ? cleaned
      : `${cleaned}.${ext}`;
  // Namespace under workspace so objects stay tenant-scoped.
  return `workspaces/${workspaceId}/${withExt}`;
}

// POST /v1/media/upload — { path, data_url } → { public_url, storage_path }
mediaRoutes.post("/upload", async (c) => {
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const parsed = uploadSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { buffer, contentType, ext } = parseDataUrl(parsed.data.data_url);
  const storagePath = sanitizePath(parsed.data.path, ext, ws);
  const sb = getSupabaseAdmin();

  const { error } = await sb.storage
    .from("vantage-media")
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new HTTPException(500, { message: `Storage upload failed: ${error.message}` });

  const { data } = sb.storage.from("vantage-media").getPublicUrl(storagePath);
  return c.json({ public_url: data.publicUrl, storage_path: storagePath });
});

// GET /v1/media/gallery — every asset this workspace has produced, newest first.
//   ?source=piece|demoforge|brand_kit|clip  ?kind=image|video  ?limit=  ?offset=
mediaRoutes.get("/gallery", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const limit  = Math.min(Math.max(Number(c.req.query("limit") ?? 60) || 60, 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const source = c.req.query("source") ?? null;
  const kind   = c.req.query("kind") ?? null;

  // Every query is workspace-filtered — that, not the Storage path layout, is
  // what makes the gallery tenant-safe. See lib/media-gallery.ts.
  const [pieces, jobs, kits, clips] = await Promise.all([
    sb.from("content_pieces")
      .select("id, channel_slug, image_url, video_url, content_payload, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(GALLERY_SCAN_LIMIT),
    sb.from("demoforge_jobs")
      .select("id, content_piece_id, target_format, output_url, thumbnail_url, extracted_frames, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(GALLERY_SCAN_LIMIT),
    sb.from("brand_kits")
      .select("id, name, logo_url, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(GALLERY_SCAN_LIMIT),
    // Clips with a null workspace_id are the shared global library.
    sb.from("intro_outro_clips")
      .select("id, name, type, preview_url, storage_path, created_at, workspace_id")
      .or(`workspace_id.eq.${ws},workspace_id.is.null`)
      .order("created_at", { ascending: false }).limit(GALLERY_SCAN_LIMIT),
  ]);

  const firstErr = pieces.error ?? jobs.error ?? kits.error ?? clips.error;
  if (firstErr) throw new HTTPException(500, { message: firstErr.message });

  const publicUrlFor = (path: string) =>
    sb.storage.from("vantage-media").getPublicUrl(path).data.publicUrl;

  const all: MediaItem[] = [
    ...(pieces.data ?? []).flatMap((p) => itemsFromPiece(p as never)),
    ...(jobs.data   ?? []).flatMap((j) => itemsFromJob(j as never)),
    ...(kits.data   ?? []).flatMap((k) => itemsFromBrandKit(k as never)),
    ...(clips.data  ?? []).flatMap((cl) => itemsFromClip(cl as never, publicUrlFor)),
  ];

  return c.json({ ...assembleGallery(all, { source, kind, limit, offset }), scan_limit: GALLERY_SCAN_LIMIT });
});
