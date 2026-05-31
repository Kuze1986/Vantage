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
    const msg = typeof body === "object" && body && "error" in body
      ? String((body as { error: string }).error) : text;
    throw new HTTPException(res.status as 400 | 500, { message: msg });
  }
  return body;
}

const scriptStepSchema = z.object({
  action:    z.enum(["navigate", "click", "fill", "wait", "scroll", "narrate"]),
  selector:  z.string().optional(),
  text:      z.string().optional(),
  ms:        z.number().int().positive().optional(),
  narration: z.string().default(""),
});

const jobBodySchema = z.object({
  content_piece_id: z.string().uuid().optional(),
  target_format:    z.enum(["tiktok", "linkedin", "instagram"]),
  url:              z.string().url(),
  script:           z.array(scriptStepSchema).min(1).max(30),
  music_track_id:   z.string().uuid().optional(),
  voice_id:         z.string().optional(),
});

// POST /v1/demoforge/jobs — create a video job
demoforgeRoutes.post("/jobs", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = jobBodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const result = await demoFetch("/jobs", {
    method: "POST",
    body:   JSON.stringify(parsed.data),
  }) as { job_id: string; status: string };

  await logActivity({
    source: "demoforge", source_type: "adapter",
    event_type: "demoforge_job_created",
    summary: `DemoForge job created for ${parsed.data.target_format}`,
    payload: { job_id: result.job_id, target_format: parsed.data.target_format },
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
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("demoforge_jobs")
    .select("id, content_piece_id, status, target_format, output_url, error_message, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ jobs: data ?? [] });
});
