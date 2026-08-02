/**
 * In-process job queue for DemoForge video generation.
 *
 * Jobs are persisted to vantage.demoforge_jobs (via public view) so that
 * vantage-api can poll status. Processing is sequential (one at a time) to
 * avoid overloading the Railway worker with concurrent Playwright sessions.
 */
import { createClient } from "@supabase/supabase-js";
import { processJob } from "./processor.js";

export type JobStatus =
  | "pending"
  | "recording"
  | "synthesizing"
  | "mixing"
  | "done"
  | "failed";

export interface WordTiming {
  word: string;
  start_sec: number;
  end_sec: number;
}

export interface CaptionConfig {
  enabled: boolean;
  font_size?: number;            // default 56 portrait / 40 landscape
  font_family?: "mono" | "sans";
  primary_color?: string;        // hex, default '#FFFFFF'
  outline_color?: string;        // hex, default '#000000'
  background?: boolean;          // semi-transparent box behind text
  position?: "top" | "center" | "bottom";  // default 'bottom'
  word_highlight?: boolean;      // karaoke-style current word
  highlight_color?: string;      // hex, default '#FFFF00'
  max_words_per_line?: number;   // default 4 portrait / 6 landscape
}

export interface OverlayConfig {
  type: "text" | "image";
  // text fields
  content?: string;
  font_size?: number;
  font_color?: string;
  font_family?: "mono" | "sans" | "display";
  box_color?: string;
  // image fields
  brand_kit_id?: string;
  width?: number;
  // position
  x: "left" | "center" | "right" | number;
  y: "top" | "center" | "bottom" | number;
  x_offset?: number;
  y_offset?: number;
  // timing
  start_sec?: number;
  end_sec?: number;
}

export type ColorGradePreset = "clean" | "warm" | "cinematic" | "vibrant" | "muted" | "cool" | "dark";

export interface ColorGradeConfig {
  preset?: ColorGradePreset;
  custom?: {
    brightness?: number;   // -1.0 to 1.0
    contrast?: number;     // 0.5 to 2.0
    saturation?: number;   // 0 to 3.0
    red_gain?: number;     // -0.5 to 0.5
    green_gain?: number;
    blue_gain?: number;
    gamma?: number;        // 0.1 to 10
  };
}

export interface DemoJob {
  id:              string;
  content_piece_id?: string;
  target_format:   "tiktok" | "linkedin" | "instagram";
  input_payload:   {
    url:     string;
    script:  ScriptStep[];
    music_track_id?: string;
    voice_id?: string;
    tts_provider?: "elevenlabs" | "voicebox";
    narration_volume?: number;  // 0-100, default 100
    music_volume?: number;      // 0-100, default 15
    master_volume?: number;     // 0-100, default 100
    // Phase 1: video overlays
    overlays?: OverlayConfig[];
    brand_kit_id?: string;
    // Phase 2: auto-captions
    caption_config?: CaptionConfig;
    // Phase 3: color grading
    color_grade?: ColorGradeConfig;
    // Phase 4: intro/outro sequences
    intro_clip_id?: string;
    outro_clip_id?: string;
    // Phase 5: timeline controls
    timeline_config?: TimelineConfig;
  };
}

export interface TimelineConfig {
  target_duration_sec?: number;   // auto-scale wait steps to hit this length
  trim_start_sec?: number;        // cut N seconds from the start of the recording
  trim_end_sec?: number;          // cut N seconds from the end of the recording
  global_speed_multiplier?: number; // 0.5–2.0; <1 slows down, >1 speeds up
  per_step_speed?: boolean;       // opt-in: per-step speed_multiplier column
}

export interface ScriptStep {
  action:    "navigate" | "click" | "fill" | "wait" | "scroll" | "narrate" | "eval" | "run" | "capture";
  selector?: string;
  text?:     string;
  ms?:       number;
  narration: string;
  soundEffect?: {
    effectId: string;
    delayMs: number;
    volumePercent: number;
  };
  speed_multiplier?: number;      // 0.5–2.0, per-step speed (requires per_step_speed flag)
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ── In-memory queue ───────────────────────────────────────────────────────────
const pending: DemoJob[] = [];
let processing = false;

export async function enqueue(job: DemoJob): Promise<void> {
  pending.push(job);
  void drain();
}

async function drain(): Promise<void> {
  if (processing || pending.length === 0) return;
  processing = true;

  const job = pending.shift()!;
  const sb  = getSupabase();

  try {
    await sb.from("demoforge_jobs").update({ status: "recording", updated_at: new Date().toISOString() }).eq("id", job.id);
    const outputUrl = await processJob(job, async (status: JobStatus) => {
      await sb.from("demoforge_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", job.id);
    });
    await sb.from("demoforge_jobs").update({
      status: "done", output_url: outputUrl, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    await writeBackMediaToPiece(sb, job.content_piece_id, {
      status: "ready",
      videoUrl: outputUrl,
      jobId: job.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await sb.from("demoforge_jobs").update({
        status: "failed", error_message: msg.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } catch { /* best-effort status update — ignore if it fails */ }
    await writeBackMediaToPiece(sb, job.content_piece_id, {
      status: "failed",
      error: msg.slice(0, 500),
      jobId: job.id,
    });
    console.error(`[demoforge] job ${job.id} failed:`, msg);
  } finally {
    processing = false;
    void drain(); // pick up next job
  }
}

/** When a job is tied to a content piece, mirror video/keyframe onto the piece. */
async function writeBackMediaToPiece(
  sb: ReturnType<typeof getSupabase>,
  contentPieceId: string | undefined,
  opts: { status: "ready" | "failed"; videoUrl?: string; error?: string; jobId: string },
): Promise<void> {
  if (!contentPieceId) return;
  try {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id, content_payload, image_url, status, scheduled_for, workspace_id")
      .eq("id", contentPieceId)
      .maybeSingle();
    if (!piece) return;

    const payload =
      piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
        ? { ...(piece.content_payload as Record<string, unknown>) }
        : {};

    if (opts.status === "failed") {
      payload.demoforge_job_id = opts.jobId;
      payload.media_error = opts.error ?? "DemoForge job failed";
      await sb
        .from("content_pieces")
        .update({
          media_status: "failed",
          content_payload: payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contentPieceId);
      return;
    }

    let imageUrl: string | null = typeof piece.image_url === "string" ? piece.image_url : null;
    const { data: jobRow } = await sb
      .from("demoforge_jobs")
      .select("extracted_frames, thumbnail_url")
      .eq("id", opts.jobId)
      .maybeSingle();
    const frames = (jobRow?.extracted_frames as Array<{ url?: string; mode?: string }> | null) ?? [];
    const usable = frames.filter((f) => typeof f?.url === "string");
    const modeStills = usable
      .filter((f) => typeof f.mode === "string" && f.mode.length > 0)
      .map((f) => ({ mode: String(f.mode), url: String(f.url) }));
    // product_still → Sweep mode still when tagged, else last keyframe; otherwise honor index/first.
    const visualType = typeof payload.visual_type === "string" ? payload.visual_type : "";
    const explicitIdx =
      typeof payload.thumbnail_frame_index === "number" ? payload.thumbnail_frame_index : null;
    let frameIdx = 0;
    let frameUrl: string | undefined;
    if (typeof explicitIdx === "number" && explicitIdx >= 0 && usable.length) {
      frameIdx = Math.min(Math.floor(explicitIdx), usable.length - 1);
      frameUrl = usable[frameIdx]?.url;
    } else if (visualType === "product_still") {
      const sweep = modeStills.find((m) => m.mode === "sweep") ?? modeStills[modeStills.length - 1];
      if (sweep) {
        frameUrl = sweep.url;
        frameIdx = usable.findIndex((f) => f.url === sweep.url);
        if (frameIdx < 0) frameIdx = 0;
      } else if (usable.length) {
        frameIdx = usable.length - 1;
        frameUrl = usable[frameIdx]?.url;
      }
    } else if (usable.length) {
      frameUrl = usable[0]?.url;
    }
    if (frameUrl) imageUrl = frameUrl;

    if (opts.videoUrl) payload.video_url = opts.videoUrl;
    if (imageUrl) payload.image_url = imageUrl;
    payload.demoforge_job_id = opts.jobId;
    if (usable.length) payload.thumbnail_frame_index = frameIdx;
    if (modeStills.length) {
      payload.mode_stills = modeStills;
      payload.product_still_modes = modeStills.map((m) => m.mode);
    }
    delete payload.media_error;

    if (frameUrl) {
      await sb
        .from("demoforge_jobs")
        .update({ thumbnail_url: frameUrl, updated_at: new Date().toISOString() })
        .eq("id", opts.jobId);
    }

    // Autopilot: approved + scheduled_for → queued once media is ready
    const autoQueue =
      piece.status === "approved" &&
      typeof piece.scheduled_for === "string" &&
      piece.scheduled_for.length > 0;

    await sb
      .from("content_pieces")
      .update({
        media_status: "ready",
        video_url: opts.videoUrl ?? null,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        content_payload: payload,
        ...(autoQueue ? { status: "queued" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contentPieceId);

    if (autoQueue) {
      console.log(`[demoforge] auto-queued piece ${contentPieceId} after media ready`);
    }
  } catch (err) {
    console.warn(`[demoforge] media write-back failed for piece ${contentPieceId}:`, err);
  }
}
