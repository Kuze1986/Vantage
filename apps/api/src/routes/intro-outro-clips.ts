import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const introOutroClipsRoutes = new Hono();

const SELECT_COLS = "id, workspace_id, type, name, duration_ms, storage_path, target_format, brand_kit_id, preview_url, created_at, updated_at";

// GET /v1/intro-outro-clips?format=tiktok&type=intro
introOutroClipsRoutes.get("/", async (c) => {
  const ws     = c.get("workspaceId");
  const format = c.req.query("format");
  const type   = c.req.query("type");
  const sb     = getSupabaseAdmin();

  let q = sb
    .from("intro_outro_clips")
    .select(SELECT_COLS)
    .order("name");

  // Include workspace clips OR global library (workspace_id IS NULL)
  q = q.or(`workspace_id.eq.${ws},workspace_id.is.null`);

  if (format) q = q.or(`target_format.eq.${format},target_format.eq.all`);
  if (type && type !== "both") q = q.in("type", [type, "both"]);

  const { data, error } = await q;
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ clips: data ?? [] });
});

// GET /v1/intro-outro-clips/:id
introOutroClipsRoutes.get("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("intro_outro_clips")
    .select(SELECT_COLS)
    .eq("id", id)
    .or(`workspace_id.eq.${ws},workspace_id.is.null`)
    .single();

  if (error || !data) throw new HTTPException(404, { message: "Clip not found" });
  return c.json({ clip: data });
});

const clipSchema = z.object({
  type:          z.enum(["intro", "outro", "both"]),
  name:          z.string().min(1).max(120),
  duration_ms:   z.number().int().nonnegative().optional(),
  storage_path:  z.string().min(1),
  target_format: z.enum(["tiktok", "linkedin", "instagram", "all"]),
  brand_kit_id:  z.string().uuid().optional(),
  preview_url:   z.string().url().optional(),
});

// POST /v1/intro-outro-clips
introOutroClipsRoutes.post("/", async (c) => {
  const ws   = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const parsed = clipSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("intro_outro_clips")
    .insert({ ...parsed.data, workspace_id: ws })
    .select("id, name")
    .single();

  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true, clip: data }, 201);
});

// PATCH /v1/intro-outro-clips/:id
introOutroClipsRoutes.patch("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const json = await c.req.json().catch(() => ({}));
  const parsed = clipSchema.partial().safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("intro_outro_clips")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", ws)
    .select("id, name")
    .single();

  if (error || !data) throw new HTTPException(404, { message: error?.message ?? "Clip not found" });
  return c.json({ ok: true, clip: data });
});

// DELETE /v1/intro-outro-clips/:id
introOutroClipsRoutes.delete("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("intro_outro_clips")
    .delete()
    .eq("id", id)
    .eq("workspace_id", ws);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
