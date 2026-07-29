import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const queueRoutes = new Hono();

// 3B-2: Calendar endpoint — pieces with scheduled_for in a date range
queueRoutes.get("/calendar", async (c) => {
  const ws   = c.get("workspaceId");
  const sb   = getSupabaseAdmin();
  const from = c.req.query("from"); // ISO date string
  const to   = c.req.query("to");   // ISO date string
  if (!from || !to) return c.json({ error: "from and to query params are required" }, 400);

  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, scheduled_for, published_at")
    .eq("workspace_id", ws)
    .in("status", ["queued", "published"])
    .gte("scheduled_for", from)
    .lte("scheduled_for", to)
    .order("scheduled_for", { ascending: true })
    .limit(500);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ pieces: data ?? [] });
});

queueRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, audit_notes, audit_iterations, created_at, image_url, video_url, media_status, variant_group_id, retry_count, retry_after, topic_id")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ pieces: data ?? [] });
});

// PATCH /v1/queue/:id — attach media / update payload fields on a piece
queueRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const schema = z.object({
    image_url: z.string().url().nullable().optional(),
    video_url: z.string().url().nullable().optional(),
    media_status: z.enum(["none", "pending", "ready", "failed"]).optional(),
    content_payload_patch: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, content_payload, image_url, video_url, media_status")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });

  const payload =
    piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
      ? { ...(piece.content_payload as Record<string, unknown>) }
      : {};

  if (parsed.data.content_payload_patch) {
    Object.assign(payload, parsed.data.content_payload_patch);
  }
  if (parsed.data.image_url !== undefined) {
    if (parsed.data.image_url) payload.image_url = parsed.data.image_url;
    else delete payload.image_url;
  }
  if (parsed.data.video_url !== undefined) {
    if (parsed.data.video_url) payload.video_url = parsed.data.video_url;
    else delete payload.video_url;
  }

  const mediaStatus =
    parsed.data.media_status ??
    (parsed.data.image_url || parsed.data.video_url ? "ready" : undefined);

  const { data: updated, error } = await sb
    .from("content_pieces")
    .update({
      ...(parsed.data.image_url !== undefined ? { image_url: parsed.data.image_url } : {}),
      ...(parsed.data.video_url !== undefined ? { video_url: parsed.data.video_url } : {}),
      ...(mediaStatus ? { media_status: mediaStatus } : {}),
      content_payload: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws)
    .eq("id", id)
    .select("id, image_url, video_url, media_status, content_payload")
    .single();
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ piece: updated });
});

// 3A-6: Retry a failed piece — resets status to queued with a fresh scheduled_for
queueRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, retry_count")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "failed") {
    throw new HTTPException(400, { message: `Cannot retry piece with status '${piece.status}' — only 'failed' pieces can be retried` });
  }

  const { error } = await sb.from("content_pieces").update({
    status:      "queued",
    retry_count: 0,          // reset counter for manual retry
    retry_after: null,
    scheduled_for: new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  }).eq("workspace_id", ws).eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true });
});
