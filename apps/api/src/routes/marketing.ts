/**
 * Portfolio marketing resource API.
 * Consumed by DemoForge, Crucible, and future NEXUS product landings.
 *
 * GET  /v1/marketing              — list all six product pack summaries
 * GET  /v1/marketing/:productSlug — brand pack + approved pieces + assets
 * POST /v1/marketing/assets       — persist a creative export (JWT workspace path)
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { loadBrandVoice, packFromVoice, seedBrandVoicesForWorkspace } from "../lib/brand-voice.js";
import { PRODUCT_SLUGS, isProductSlug, parseProductSlug } from "../lib/products.js";

export const marketingRoutes = new Hono();

const PIECE_STATUSES = ["approved", "queued", "published"] as const;

marketingRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  await seedBrandVoicesForWorkspace(sb, ws);

  const products = [];
  for (const slug of PRODUCT_SLUGS) {
    const voice = await loadBrandVoice(ws, slug);
    const pack = packFromVoice(voice);
    const { count } = await sb
      .from("content_pieces")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .eq("product_slug", slug)
      .in("status", [...PIECE_STATUSES]);
    products.push({
      product: slug,
      name: pack.name,
      essence: pack.essence,
      handle: pack.handle,
      domain: pack.domain,
      accent: pack.accent,
      launch: {
        eyebrow: pack.launch.eyebrow,
        headline: pack.launch.sqHeadline,
        sub: pack.launch.sqSub,
        cta: pack.launch.cta,
        metrics: pack.launch.metrics,
      },
      piece_count: count ?? 0,
    });
  }
  return c.json({ products });
});

marketingRoutes.get("/:productSlug", async (c) => {
  const slugParam = c.req.param("productSlug");
  if (!isProductSlug(slugParam)) {
    throw new HTTPException(404, { message: `Unknown product: ${slugParam}` });
  }
  const slug = slugParam;
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const statusParam = c.req.query("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [...PIECE_STATUSES];
  const channel = c.req.query("channel");
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);

  const voice = await loadBrandVoice(ws, slug);
  const brand = packFromVoice(voice);

  let pieceQuery = sb
    .from("content_pieces")
    .select(
      "id, channel_slug, format, status, content_payload, image_url, video_url, media_status, published_at, created_at, product_slug",
    )
    .eq("workspace_id", ws)
    .eq("product_slug", slug)
    .in("status", statuses)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (channel) pieceQuery = pieceQuery.eq("channel_slug", channel);

  const { data: pieces, error: pErr } = await pieceQuery;
  if (pErr) throw new HTTPException(500, { message: pErr.message });

  const { data: assets, error: aErr } = await sb
    .from("marketing_assets")
    .select("id, kind, public_url, storage_path, content_piece_id, meta, created_at")
    .eq("workspace_id", ws)
    .eq("product_slug", slug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (aErr) throw new HTTPException(500, { message: aErr.message });

  return c.json({
    product: slug,
    brand: {
      name: brand.name,
      essence: brand.essence,
      handle: brand.handle,
      domain: brand.domain,
      accent: brand.accent,
      accent2: brand.accent2,
      palette: brand.palette,
      voice: brand.voice,
      captions: brand.captions,
      hashtags: brand.hashtags,
      launch: brand.launch,
      insight: brand.insight,
    },
    voice: {
      name: voice.name,
      description: voice.description,
      per_channel_tone: voice.per_channel_tone,
      off_topics: voice.off_topics,
    },
    pieces: pieces ?? [],
    assets: assets ?? [],
  });
});

const assetSchema = z.object({
  product_slug: z.string().min(1),
  kind: z.enum(["og", "square", "story", "x", "linkedin", "image", "video", "other"]).default("image"),
  data_url: z.string().min(1),
  content_piece_id: z.string().uuid().optional(),
  meta: z.record(z.unknown()).optional(),
});

marketingRoutes.post("/assets", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = assetSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const productSlug = parseProductSlug(parsed.data.product_slug);
  if (!isProductSlug(parsed.data.product_slug)) {
    throw new HTTPException(400, { message: "Invalid product_slug" });
  }

  const m = /^data:([^;]+);base64,(.+)$/i.exec(parsed.data.data_url.trim());
  if (!m) throw new HTTPException(400, { message: "data_url must be a base64 data URL" });
  const contentType = m[1]!.toLowerCase();
  const buffer = Buffer.from(m[2]!, "base64");
  if (buffer.length > 8 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Asset must be 8MB or smaller" });
  }
  const ext =
    contentType.includes("png") ? "png"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : contentType.includes("mp4") ? "mp4"
    : "jpg";

  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const id = crypto.randomUUID();
  const path = `marketing-assets/${ws}/${productSlug}/${id}.${ext}`;

  const { error: upErr } = await sb.storage
    .from("vantage-media")
    .upload(path, buffer, { contentType, upsert: true });
  if (upErr) throw new HTTPException(500, { message: upErr.message });

  const { data: pub } = sb.storage.from("vantage-media").getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { data: row, error } = await sb
    .from("marketing_assets")
    .insert({
      id,
      workspace_id: ws,
      product_slug: productSlug,
      kind: parsed.data.kind,
      storage_path: path,
      public_url: publicUrl,
      content_piece_id: parsed.data.content_piece_id ?? null,
      meta: parsed.data.meta ?? {},
    })
    .select("id, kind, public_url, storage_path, content_piece_id, meta, created_at")
    .single();
  if (error || !row) throw new HTTPException(500, { message: error?.message ?? "insert failed" });

  return c.json({ asset: row }, 201);
});
