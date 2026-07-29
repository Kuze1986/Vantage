/**
 * DemoForge proxy — vantage-api forwards video job requests to the DemoForge
 * service (separate Railway deployment). Clients never talk to DemoForge directly.
 *
 * Required env var: DEMOFORGE_URL (e.g. https://demoforge.up.railway.app)
 * Optional:         DEMOFORGE_SECRET (shared HMAC secret for service-to-service auth)
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import {
  buildDemoForgePayload,
  listDemoForgeTemplates,
  resolveTemplateId,
} from "../lib/demoforge-templates.js";

export const demoforgeRoutes = new Hono();

function getDemoForgeBase(): string {
  let url = process.env.DEMOFORGE_URL;
  if (!url) throw new HTTPException(503, { message: "DEMOFORGE_URL is not configured. Set it in Railway (e.g. https://demoforge-worker.up.railway.app)" });
  // Normalize — Railway env vars are often set without the protocol prefix
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, "");
}

async function demoFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const base    = getDemoForgeBase();
  const secret  = process.env.DEMOFORGE_SECRET;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (secret) headers.set("x-demoforge-secret", secret);

  const res  = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    // demoforge returns { error: "..." }; Railway 502s return { message: "..." }
    const msg =
      typeof body === "object" && body && "error"   in body ? String((body as { error:   string }).error)   :
      typeof body === "object" && body && "message" in body ? String((body as { message: string }).message) :
      text || `demoforge responded ${res.status}`;
    const status = res.status >= 400 && res.status < 600 ? res.status as 400 | 500 : 500;
    throw new HTTPException(status, { message: `DemoForge: ${msg}` });
  }
  return body;
}

const soundEffectSchema = z.object({
  effectId: z.string().uuid(),
  delayMs: z.number().int().nonnegative(),
  volumePercent: z.number().int().min(0).max(100),
});

const scriptStepSchema = z.object({
  action:    z.enum(["navigate", "click", "fill", "wait", "scroll", "narrate", "eval", "run"]),
  selector:  z.string().optional(),
  text:      z.string().optional(),
  ms:        z.number().int().positive().optional(),
  narration: z.string().default(""),
  soundEffect: soundEffectSchema.optional(),
});

const overlaySchema = z.object({
  type:        z.enum(["text", "image"]),
  content:     z.string().optional(),
  font_size:   z.number().int().min(8).max(200).optional(),
  font_color:  z.string().optional(),
  font_family: z.enum(["mono", "sans", "display"]).optional(),
  box_color:   z.string().optional(),
  brand_kit_id: z.string().uuid().optional(),
  width:       z.number().int().positive().optional(),
  x:           z.union([z.enum(["left", "center", "right"]), z.number()]),
  y:           z.union([z.enum(["top", "center", "bottom"]), z.number()]),
  x_offset:    z.number().optional(),
  y_offset:    z.number().optional(),
  start_sec:   z.number().min(0).optional(),
  end_sec:     z.number().min(0).optional(),
});

const captionConfigSchema = z.object({
  enabled:            z.boolean(),
  font_size:          z.number().int().min(8).max(200).optional(),
  font_family:        z.enum(["mono", "sans"]).optional(),
  primary_color:      z.string().optional(),
  outline_color:      z.string().optional(),
  background:         z.boolean().optional(),
  position:           z.enum(["top", "center", "bottom"]).optional(),
  word_highlight:     z.boolean().optional(),
  highlight_color:    z.string().optional(),
  max_words_per_line: z.number().int().min(1).max(12).optional(),
});

const colorGradeSchema = z.object({
  preset: z.enum(["clean", "warm", "cinematic", "vibrant", "muted", "cool", "dark"]).optional(),
  custom: z.object({
    brightness: z.number().min(-1).max(1).optional(),
    contrast:   z.number().min(0.5).max(2).optional(),
    saturation: z.number().min(0).max(3).optional(),
    red_gain:   z.number().min(-0.5).max(0.5).optional(),
    green_gain: z.number().min(-0.5).max(0.5).optional(),
    blue_gain:  z.number().min(-0.5).max(0.5).optional(),
    gamma:      z.number().min(0.1).max(10).optional(),
  }).optional(),
});

const jobBodySchema = z.object({
  content_piece_id: z.string().uuid().optional(),
  target_format:    z.enum(["tiktok", "linkedin", "instagram"]),
  url:              z.string().url(),
  script:           z.array(scriptStepSchema).min(1).max(40),
  music_track_id:   z.string().uuid().optional(),
  voice_id:         z.string().optional(),
  tts_provider:     z.enum(["elevenlabs", "voicebox"]).optional(),
  narration_volume: z.number().int().min(0).max(100).optional(),
  music_volume:     z.number().int().min(0).max(100).optional(),
  master_volume:    z.number().int().min(0).max(100).optional(),
  // Phase 1: video overlays
  overlays:         z.array(overlaySchema).max(10).optional(),
  brand_kit_id:     z.string().uuid().optional(),
  // Phase 2: auto-captions
  caption_config:   captionConfigSchema.optional(),
  // Phase 3: color grading
  color_grade:      colorGradeSchema.optional(),
  // Phase 4: intro/outro
  intro_clip_id:    z.string().uuid().optional(),
  outro_clip_id:    z.string().uuid().optional(),
  // Phase 5: timeline
  timeline_config:  z.object({
    target_duration_sec:     z.number().positive().optional(),
    trim_start_sec:          z.number().min(0).optional(),
    trim_end_sec:            z.number().min(0).optional(),
    global_speed_multiplier: z.number().min(0.25).max(4).optional(),
    per_step_speed:          z.boolean().optional(),
  }).optional(),
});

// GET /v1/demoforge/templates — registry of DemoForge script templates
demoforgeRoutes.get("/templates", async (c) => {
  const templates = listDemoForgeTemplates().map((t) => ({
    id: t.id,
    name: t.name ?? t.id,
    format: t.format,
    default_base_url: t.defaultBaseUrl ?? null,
    step_count: t.steps.length,
  }));
  return c.json({
    templates,
    defaults_by_channel: {
      x: "shift-queue-modes",
      linkedin: "shift-ube-university-demo",
      tiktok: "shift-queue-reel",
      instagram: "shift-queue-reel",
    },
  });
});

// POST /v1/demoforge/jobs/from-template — enqueue from a registry template + piece
demoforgeRoutes.post("/jobs/from-template", async (c) => {
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const schema = z.object({
    template_id: z.string().min(1).optional(),
    channel: z.string().optional(),
    content_piece_id: z.string().uuid(),
    base_url: z.string().url().optional(),
    captions: z.boolean().optional(),
    color_preset: z.enum(["cinematic", "clean", "warm", "vibrant", "muted", "cool", "dark"]).optional(),
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const templateId = resolveTemplateId({
    ideaTemplateId: parsed.data.template_id,
    channel: parsed.data.channel,
  });
  const payload = buildDemoForgePayload(templateId, parsed.data.base_url, {
    captions: parsed.data.captions,
    colorPreset: parsed.data.color_preset ?? "cinematic",
  });

  const sb = getSupabaseAdmin();
  const { data: piece } = await sb
    .from("content_pieces")
    .select("id, content_payload")
    .eq("id", parsed.data.content_piece_id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!piece) throw new HTTPException(404, { message: "Content piece not found" });

  const result = await demoFetch("/jobs", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      workspace_id: ws,
      content_piece_id: parsed.data.content_piece_id,
    }),
  }) as { job_id: string; status: string };

  const prev =
    piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
      ? { ...(piece.content_payload as Record<string, unknown>) }
      : {};
  prev.demoforge_job_id = result.job_id;
  prev.demoforge_template_id = templateId;
  delete prev.media_error;

  await sb
    .from("content_pieces")
    .update({
      media_status: "pending",
      content_payload: prev,
      updated_at: new Date().toISOString(),
    })
    .eq("id", piece.id)
    .eq("workspace_id", ws);

  await logActivity({
    source: "demoforge",
    source_type: "adapter",
    event_type: "demoforge_job_created",
    summary: `DemoForge job from template ${templateId}`,
    payload: { job_id: result.job_id, template_id: templateId, content_piece_id: piece.id },
    workspace_id: ws,
  });

  return c.json({ ...result, template_id: templateId }, 202);
});

// POST /v1/demoforge/jobs — create a video job
demoforgeRoutes.post("/jobs", async (c) => {
  const ws = c.get("workspaceId");
  const json   = await c.req.json().catch(() => ({}));
  const parsed = jobBodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const result = await demoFetch("/jobs", {
    method: "POST",
    body:   JSON.stringify({ ...parsed.data, workspace_id: ws }),
  }) as { job_id: string; status: string };

  await logActivity({
    source: "demoforge", source_type: "adapter",
    event_type: "demoforge_job_created",
    summary: `DemoForge job created for ${parsed.data.target_format}`,
    payload: { job_id: result.job_id, target_format: parsed.data.target_format },
    workspace_id: ws,
  });

  return c.json(result, 202);
});

// GET /v1/demoforge/jobs/:id — poll job status
demoforgeRoutes.get("/jobs/:id", async (c) => {
  const id     = c.req.param("id");
  const result = await demoFetch(`/jobs/${id}`);
  return c.json(result);
});

// GET /v1/demoforge/jobs — list recent jobs from the DB (no DemoForge call needed)
demoforgeRoutes.get("/jobs", async (c) => {
  const ws = c.get("workspaceId");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("demoforge_jobs")
    .select("id, content_piece_id, status, target_format, output_url, error_message, created_at, updated_at")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ jobs: data ?? [] });
});
