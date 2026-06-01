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

export interface DemoJob {
  id:              string;
  content_piece_id?: string;
  target_format:   "tiktok" | "linkedin" | "instagram";
  input_payload:   {
    url:     string;
    script:  ScriptStep[];
    music_track_id?: string;
    voice_id?: string;
    narration_volume?: number;  // 0-100, default 100
    music_volume?: number;      // 0-100, default 15
    master_volume?: number;     // 0-100, default 100
  };
}

export interface ScriptStep {
  action:    "navigate" | "click" | "fill" | "wait" | "scroll" | "narrate";
  selector?: string;
  text?:     string;
  ms?:       number;
  narration: string;
  soundEffect?: {
    effectId: string;
    delayMs: number;
    volumePercent: number;
  };
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await sb.from("demoforge_jobs").update({
        status: "failed", error_message: msg.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } catch { /* best-effort status update — ignore if it fails */ }
    console.error(`[demoforge] job ${job.id} failed:`, msg);
  } finally {
    processing = false;
    void drain(); // pick up next job
  }
}
