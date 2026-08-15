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

const ALLOWED_PREFIXES = ["og/", "quotes/", "thumbnails/", "creative/", "music/", "uploads/"] as const;

const uploadSchema = z.object({
  path: z.string().min(3).max(240),
  data_url: z.string().min(1),
  title: z.string().min(1).max(160).optional(),
});

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new HTTPException(400, { message: "data_url must be a base64 data URL" });
  const contentType = m[1]!.toLowerCase();
  if (!contentType.startsWith("image/") && !contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    throw new HTTPException(400, { message: "Upload must be an image, video, or audio data URL" });
  }
  const ext =
    contentType.includes("mpeg") || contentType.includes("mp3") ? "mp3"
    : contentType.includes("wav") ? "wav"
    : contentType.includes("ogg") ? "ogg"
    : contentType.includes("mp4") ? "mp4"
    : contentType.includes("webm") ? "webm"
    : contentType.includes("quicktime") ? "mov"
    : contentType.includes("png") ? "png"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : "jpg";
  const buffer = Buffer.from(m[2]!, "base64");
  if (buffer.length > 32 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Media must be 32MB or smaller" });
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
    /\.(png|jpg|jpeg|webp|gif|mp3|wav|ogg|mp4|webm|mov)$/i.test(cleaned)
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
  const catalogMedia = contentType.startsWith("image/") || contentType.startsWith("video/");
  let cataloged = false;

  // Check the catalog before touching Storage. That lets a retry reuse an
  // already-registered object and avoids ever deleting an object whose prior
  // ownership we could not establish.
  if (catalogMedia) {
    const { data: existing, error: lookupError } = await sb
      .from("media_assets")
      .select("id")
      .eq("workspace_id", ws)
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (lookupError) throw new HTTPException(500, { message: `Media catalog lookup failed before upload: ${lookupError.message}` });
    cataloged = Boolean(existing);
  }

  const { error } = await sb.storage
    .from("vantage-media")
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new HTTPException(500, { message: `Storage upload failed: ${error.message}` });

  const { data } = sb.storage.from("vantage-media").getPublicUrl(storagePath);
  if (catalogMedia) {
    const kind = contentType.startsWith("video/") ? "video" : "image";
    const title = parsed.data.title ?? storagePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Uploaded media";
    // Storage has accepted the object at this point. Register it only when it
    // was not cataloged before the upload; repeat submissions remain safe.
    if (!cataloged) {
      const { error: assetError } = await sb.from("media_assets").insert(
        { workspace_id: ws, storage_path: storagePath, title, kind },
      );
      if (assetError) {
        // A concurrent retry may have won the catalog insert. Its row owns the
        // object now, so do not roll back the shared Storage path.
        if (assetError.code === "23505") {
          return c.json({ public_url: data.publicUrl, storage_path: storagePath });
        }
        await sb.storage.from("vantage-media").remove([storagePath]);
        throw new HTTPException(500, { message: `Media catalog update failed; the upload was rolled back: ${assetError.message}` });
      }
    }
  }
  return c.json({ public_url: data.publicUrl, storage_path: storagePath });
});

// GET /v1/media/gallery — every asset this workspace has produced, newest first.
//   ?source=piece|demoforge|brand_kit|clip  ?kind=image|video  ?limit=  ?offset=
mediaRoutes.get("/gallery", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const limit  = Math.min(Math.max(Number(c.req.query("limit") ?? 24) || 24, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const source = c.req.query("source") ?? null;
  const kind   = c.req.query("kind") ?? null;

  // Every query is workspace-filtered — that, not the Storage path layout, is
  // what makes the gallery tenant-safe. See lib/media-gallery.ts.
  const scanLimit = Math.min(GALLERY_SCAN_LIMIT, Math.max(100, offset + limit));
  const [pieces, jobs, kits, clips, uploads, deletions] = await Promise.all([
    sb.from("content_pieces")
      .select("id, channel_slug, image_url, video_url, content_payload, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(scanLimit),
    sb.from("demoforge_jobs")
      .select("id, content_piece_id, target_format, output_url, thumbnail_url, extracted_frames, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(scanLimit),
    sb.from("brand_kits")
      .select("id, name, logo_url, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(scanLimit),
    // Clips with a null workspace_id are the shared global library.
    sb.from("intro_outro_clips")
      .select("id, name, type, preview_url, storage_path, created_at, workspace_id")
      .or(`workspace_id.eq.${ws},workspace_id.is.null`)
      .order("created_at", { ascending: false }).limit(scanLimit),
    sb.from("media_assets")
      .select("id, title, kind, storage_path, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(scanLimit),
    sb.from("media_asset_deletions").select("item_id").eq("workspace_id", ws),
  ]);

  const firstErr = pieces.error ?? jobs.error ?? kits.error ?? clips.error ?? uploads.error ?? deletions.error;
  if (firstErr) throw new HTTPException(500, { message: firstErr.message });

  const publicUrlFor = (path: string) =>
    sb.storage.from("vantage-media").getPublicUrl(path).data.publicUrl;

  const all: MediaItem[] = [
    ...(pieces.data ?? []).flatMap((p) => itemsFromPiece(p as never)),
    ...(jobs.data   ?? []).flatMap((j) => itemsFromJob(j as never)),
    ...(kits.data   ?? []).flatMap((k) => itemsFromBrandKit(k as never)),
    ...(clips.data  ?? []).flatMap((cl) => itemsFromClip(cl as never, publicUrlFor)),
    ...(uploads.data ?? []).map((asset) => ({
      id: `upload:${asset.id}`,
      kind: asset.kind as "image" | "video",
      url: publicUrlFor(asset.storage_path),
      thumbnail_url: null,
      label: asset.title,
      source: "upload" as const,
      piece_id: null,
      job_id: null,
      created_at: asset.created_at,
    })),
  ];

  const deletedIds = new Set((deletions.data ?? []).map((item) => item.item_id));
  return c.json({ ...assembleGallery(all.filter((item) => !deletedIds.has(item.id)), { source, kind, limit, offset }), scan_limit: scanLimit });
});

// DELETE /v1/media/gallery/:id — removes uploads from Storage and hides generated assets from the gallery.
mediaRoutes.delete("/gallery/:id", async (c) => {
  const ws = c.get("workspaceId");
  const itemId = decodeURIComponent(c.req.param("id"));
  const sb = getSupabaseAdmin();

  if (itemId.startsWith("upload:")) {
    const uploadId = itemId.slice("upload:".length);
    const { data: asset, error } = await sb.from("media_assets")
      .select("id, storage_path").eq("workspace_id", ws).eq("id", uploadId).maybeSingle();
    if (error) throw new HTTPException(500, { message: error.message });
    if (asset) {
      const { error: storageError } = await sb.storage.from("vantage-media").remove([asset.storage_path]);
      if (storageError) throw new HTTPException(500, { message: `Storage deletion failed: ${storageError.message}` });
      const { error: catalogError } = await sb.from("media_assets").delete().eq("workspace_id", ws).eq("id", uploadId);
      if (catalogError) throw new HTTPException(500, { message: catalogError.message });
    }
  }

  const { data: existing, error: existingError } = await sb.from("media_asset_deletions")
    .select("id").eq("workspace_id", ws).eq("item_id", itemId).maybeSingle();
  if (existingError) throw new HTTPException(500, { message: existingError.message });
  if (!existing) {
    const { error } = await sb.from("media_asset_deletions").insert({ workspace_id: ws, item_id: itemId });
    if (error) throw new HTTPException(500, { message: error.message });
  }
  return c.json({ ok: true, removed_from_storage: itemId.startsWith("upload:") });
});
