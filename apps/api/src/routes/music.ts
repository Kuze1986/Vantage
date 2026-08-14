import { Hono } from "hono";
import type { Context } from "hono";
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
  const tracks = (data ?? []).map((track) => ({
    ...track,
    public_url: sb.storage.from("vantage-media").getPublicUrl(track.storage_path).data.publicUrl,
  }));
  return c.json({ tracks });
});

musicRoutes.get("/projects", async (c) => {
  const workspaceId = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("music_projects").select("*, music_project_clips(*)").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ projects: data ?? [] });
});

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  duration_secs: z.number().positive().max(3600),
  master_volume: z.number().min(0).max(1),
  export_settings: z.record(z.unknown()).default({}),
  clips: z.array(z.object({
    track_type: z.enum(["music", "narration", "effect"]),
    music_track_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1), storage_path: z.string().nullable().optional(),
    start_secs: z.number().min(0), trim_start_secs: z.number().min(0), trim_end_secs: z.number().nullable().optional(),
    duration_secs: z.number().min(0), volume: z.number().min(0).max(1), fade_in_secs: z.number().min(0), fade_out_secs: z.number().min(0),
    loop_enabled: z.boolean(), muted: z.boolean(),
  })).default([]),
});

async function saveProject(c: Context, id?: string) {
  const workspaceId = c.get("workspaceId");
  const parsed = projectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  const sb = getSupabaseAdmin();
  const { clips, ...project } = parsed.data;
  const result = id
    ? await sb.from("music_projects").update({ ...project, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId).select().single()
    : await sb.from("music_projects").insert({ ...project, workspace_id: workspaceId }).select().single();
  if (result.error || !result.data) throw new HTTPException(500, { message: result.error?.message ?? "Could not save project" });
  if (id) await sb.from("music_project_clips").delete().eq("project_id", id);
  if (clips.length) {
    const { error } = await sb.from("music_project_clips").insert(clips.map((clip) => ({ ...clip, project_id: result.data.id })));
    if (error) throw new HTTPException(500, { message: error.message });
  }
  return c.json({ project: { ...result.data, music_project_clips: clips } });
}

musicRoutes.post("/projects", (c) => saveProject(c));
musicRoutes.put("/projects/:id", (c) => saveProject(c, c.req.param("id")));
musicRoutes.delete("/projects/:id", async (c) => {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("music_projects").delete().eq("id", c.req.param("id")).eq("workspace_id", c.get("workspaceId"));
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
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

musicRoutes.post("/upload", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ title: z.string().min(1).max(120), data_url: z.string().min(1), mood: z.string().default("general"), use_case: z.string().default("general") }).safeParse(body);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  const match = /^data:(audio\/[^;]+);base64,(.+)$/i.exec(parsed.data.data_url.trim());
  if (!match) throw new HTTPException(400, { message: "data_url must be a base64 audio data URL" });
  const contentType = match[1]!.toLowerCase();
  const ext = contentType.includes("mpeg") || contentType.includes("mp3") ? "mp3" : contentType.includes("wav") ? "wav" : "ogg";
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.length > 25 * 1024 * 1024) throw new HTTPException(400, { message: "Audio must be 25MB or smaller" });
  const workspaceId = c.get("workspaceId"); const storagePath = `workspaces/${workspaceId}/music/${crypto.randomUUID()}.${ext}`; const sb = getSupabaseAdmin();
  const upload = await sb.storage.from("vantage-media").upload(storagePath, buffer, { contentType, upsert: false });
  if (upload.error) throw new HTTPException(500, { message: upload.error.message });
  const insert = await sb.from("music_tracks").insert({ title: parsed.data.title, artist: "Uploaded", mood: parsed.data.mood, use_case: parsed.data.use_case, storage_path: storagePath }).select().single();
  if (insert.error) throw new HTTPException(500, { message: insert.error.message });
  return c.json({ track: { ...insert.data, public_url: sb.storage.from("vantage-media").getPublicUrl(storagePath).data.publicUrl } }, 201);
});

// DELETE /v1/music/:id — remove a track record (file stays in Storage)
musicRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("music_tracks").delete().eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
