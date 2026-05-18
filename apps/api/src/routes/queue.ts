import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const queueRoutes = new Hono();

queueRoutes.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, audit_notes, audit_iterations, created_at, image_url, variant_group_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ pieces: data ?? [] });
});
