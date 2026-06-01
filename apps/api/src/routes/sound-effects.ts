// routes/sound-effects.ts — CRUD for sound effects library (Phase 3D-SE)
// GET    /v1/sound-effects         — list all effects with optional filtering
// POST   /v1/sound-effects         — register a new effect
// DELETE /v1/sound-effects/:id     — remove an effect record

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

const effectBodySchema = z.object({
  title:        z.string().min(1).max(120),
  category:     z.enum(["ui_click", "transition", "success", "error", "notification", "custom"]),
  duration_ms:  z.number().int().positive().optional(),
  storage_path: z.string().min(1),
  use_case:     z.enum(["intro", "step_transition", "action_feedback", "general"]),
});

export const soundEffectsRoutes = new Hono();

// GET /v1/sound-effects — list all effects with optional filtering
soundEffectsRoutes.get("/", async (c) => {
  const category = c.req.query("category");
  const use_case = c.req.query("use_case");

  const sb = getSupabaseAdmin();
  let query = sb.from("sound_effects").select("*");

  if (category) query = query.eq("category", category);
  if (use_case) query = query.eq("use_case", use_case);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ effects: data ?? [] });
});

// POST /v1/sound-effects — register a new effect
soundEffectsRoutes.post("/", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = effectBodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sound_effects")
    .insert({
      title: parsed.data.title,
      category: parsed.data.category,
      duration_ms: parsed.data.duration_ms,
      storage_path: parsed.data.storage_path,
      use_case: parsed.data.use_case,
    })
    .select("*")
    .single();

  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ effect: data }, 201);
});

// DELETE /v1/sound-effects/:id — remove an effect record (storage file remains)
soundEffectsRoutes.delete("/:id", async (c) => {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("sound_effects").delete().eq("id", c.req.param("id"));

  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
