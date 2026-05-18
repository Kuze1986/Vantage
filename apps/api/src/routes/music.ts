import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const musicRoutes = new Hono();

// GET /v1/music — list music tracks, optionally filtered by mood or use_case
musicRoutes.get("/", async (c) => {
  const mood     = c.req.query("mood");
  const use_case = c.req.query("use_case");
  const sb = getSupabaseAdmin();

  let query = sb
    .from("music_tracks")
    .select("id, title, artist, mood, use_case, duration_secs, bpm, storage_path, created_at")
    .order("mood")
    .order("title");

  if (mood)     query = query.eq("mood", mood);
  if (use_case) query = query.eq("use_case", use_case);

  const { data, error } = await query;
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ tracks: data ?? [] });
});

// POST /v1/music — register a track (after uploading file to Supabase Storage manually)
const trackSchema = z.object({
  title:        z.string().min(1),
  artist:       z.string().optional(),
  mood:         z.enum(["upbeat", "calm", "inspirational", "corporate", "energetic", "ambient"]),
  use_case:     z.enum(["intro", "background", "outro", "general"]),
  duration_secs: z.number().int().positive().optional(),
  bpm:          z.number().int().positive().optional(),
  storage_path: z.string().min(1),
});

musicRoutes.post("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = trackSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("music_tracks")
    .insert(parsed.data)
    .select("id, title")
    .single();

  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true, track: data }, 201);
});

// DELETE /v1/music/:id — remove a track record (file stays in Storage)
musicRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("music_tracks").delete().eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
