import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const queueRoutes = new Hono();

queueRoutes.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, audit_notes, audit_iterations, created_at, image_url, variant_group_id, retry_count, retry_after")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ pieces: data ?? [] });
});

// 3A-6: Retry a failed piece — resets status to queued with a fresh scheduled_for
queueRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, retry_count")
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
  }).eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true });
});
