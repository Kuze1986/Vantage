import "dotenv/config";

// Validate required env vars before anything else — crash fast with a clear message
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[demoforge] FATAL: missing required env var ${key}`);
    process.exit(1);
  }
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { enqueue } from "./jobs/queue.js";
import type { DemoJob, ScriptStep } from "./jobs/queue.js";

const app = new Hono();

// CORS — only vantage-api should call this service
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
app.use("*", cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? origin)),
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

// Auth: simple shared secret between vantage-api and demoforge
function requireSecret(c: Parameters<Parameters<typeof app.use>[1]>[0]) {
  const secret = process.env.DEMOFORGE_SECRET;
  if (!secret) return; // no secret configured → open (dev mode)
  const auth = c.req.header("x-demoforge-secret");
  if (auth !== secret) throw new HTTPException(401, { message: "Unauthorized" });
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Job schema ────────────────────────────────────────────────────────────────
const scriptStepSchema = z.object({
  action:    z.enum(["navigate", "click", "fill", "wait", "scroll", "narrate"]),
  selector:  z.string().optional(),
  text:      z.string().optional(),
  ms:        z.number().int().positive().optional(),
  narration: z.string().default(""),
});

const jobSchema = z.object({
  workspace_id:     z.string().uuid(),
  content_piece_id: z.string().uuid().optional(),
  target_format:    z.enum(["tiktok", "linkedin", "instagram"]),
  url:              z.string().url(),
  script:           z.array(scriptStepSchema).min(1).max(30),
  music_track_id:   z.string().uuid().optional(),
  voice_id:         z.string().optional(),
});

// ── POST /jobs — submit a new video job ───────────────────────────────────────
app.post("/jobs", async (c) => {
  requireSecret(c);

  const json   = await c.req.json().catch(() => ({}));
  const parsed = jobSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { workspace_id, content_piece_id, target_format, url, script, music_track_id, voice_id } = parsed.data;

  const jobId = randomUUID();
  const sb    = getSupabase();

  // Persist job record
  const { error } = await sb.from("demoforge_jobs").insert({
    id:               jobId,
    workspace_id,
    content_piece_id: content_piece_id ?? null,
    status:           "pending",
    target_format,
    input_payload:    { url, script, music_track_id, voice_id },
  });

  if (error) throw new HTTPException(500, { message: error.message });

  const job: DemoJob = {
    id:               jobId,
    content_piece_id,
    target_format,
    input_payload: {
      url,
      script: script as ScriptStep[],
      music_track_id,
      voice_id,
    },
  };

  // Enqueue for async processing
  void enqueue(job);

  return c.json({ job_id: jobId, status: "pending" }, 202);
});

// ── GET /jobs/:id — poll job status ──────────────────────────────────────────
app.get("/jobs/:id", async (c) => {
  requireSecret(c);
  const id = c.req.param("id");
  const sb = getSupabase();

  const { data, error } = await sb
    .from("demoforge_jobs")
    .select("id, status, target_format, output_url, error_message, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) throw new HTTPException(404, { message: "Job not found" });
  return c.json(data);
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ ok: true, service: "demoforge" }));

app.onError((err, c) => {
  const status  = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error("[demoforge]", err);
  return c.json({ error: message }, status);
});

const port = Number(process.env.PORT ?? 8788);
console.log(`demoforge listening on ${port}`);
serve({ fetch: app.fetch, port });
