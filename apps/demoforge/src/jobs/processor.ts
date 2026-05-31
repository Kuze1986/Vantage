/**
 * Core DemoForge pipeline:
 *   1. Record browser session with Playwright (screen recording)
 *   2. Synthesize narration audio via ElevenLabs
 *   3. Mix video + audio + background music via FFmpeg
 *   4. Upload to Supabase Storage → return public URL
 */
import { chromium } from "playwright";
import { ElevenLabsClient } from "elevenlabs";
import ffmpeg from "fluent-ffmpeg";
import { createClient } from "@supabase/supabase-js";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DemoJob, JobStatus, ScriptStep } from "./queue.js";

// Platform video dimensions
const FORMAT_DIMS: Record<string, { width: number; height: number }> = {
  tiktok:    { width: 1080, height: 1920 },
  instagram: { width: 1080, height: 1920 },
  linkedin:  { width: 1920, height: 1080 },
};

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function getElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY");
  return new ElevenLabsClient({ apiKey: key });
}

// ── Step 1: Browser recording ─────────────────────────────────────────────────

async function recordBrowser(
  job: DemoJob,
  workDir: string,
): Promise<string> {
  const dims = FORMAT_DIMS[job.target_format] ?? FORMAT_DIMS.linkedin;
  const videoPath = join(workDir, "screen.webm");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: dims.width, height: Math.min(dims.height, 1080) },
    recordVideo: { dir: workDir, size: { width: dims.width, height: Math.min(dims.height, 1080) } },
  });
  const page = await context.newPage();

  try {
    for (const step of job.input_payload.script) {
      await executeStep(page, step);
    }
    // Brief pause at the end so last state is visible
    await page.waitForTimeout(1500);
  } finally {
    await page.close();
    const recording = await page.video()?.path();
    await context.close();
    await browser.close();
    if (recording && recording !== videoPath) {
      // Playwright may name it differently; rename to our expected path
      const { rename } = await import("node:fs/promises");
      await rename(recording, videoPath).catch(() => undefined);
    }
  }

  return videoPath;
}

async function executeStep(
  page: import("playwright").Page,
  step: ScriptStep,
): Promise<void> {
  switch (step.action) {
    case "navigate":
      // URL is stored in selector (as set by DemoForgePage.tsx); fall back to text
      await page.goto(step.selector ?? step.text ?? "", { waitUntil: "domcontentloaded", timeout: 15_000 });
      break;
    case "click":
      if (step.selector) await page.click(step.selector, { timeout: 5_000 });
      break;
    case "fill":
      if (step.selector && step.text) await page.fill(step.selector, step.text);
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 1000);
      break;
    case "scroll":
      await page.evaluate(() => window.scrollBy(0, 300));
      break;
    case "narrate":
      // Pause to let narration play in final mix — just wait here
      await page.waitForTimeout(2000);
      break;
  }
}

// ── Step 2: Voice synthesis via ElevenLabs ────────────────────────────────────

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — clear, professional

async function synthesizeNarration(
  job: DemoJob,
  workDir: string,
): Promise<string | null> {
  const narrations = job.input_payload.script
    .filter((s) => s.narration.trim().length > 0)
    .map((s) => s.narration.trim())
    .join(" ... ");

  if (!narrations) return null;

  const el      = getElevenLabs();
  const voiceId = job.input_payload.voice_id ?? DEFAULT_VOICE_ID;

  const audioStream = await el.generate({
    voice:  voiceId,
    text:   narrations,
    model_id: "eleven_multilingual_v2",
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const audioPath = join(workDir, "narration.mp3");
  await writeFile(audioPath, Buffer.concat(chunks));
  return audioPath;
}

// ── Step 3: FFmpeg mix ────────────────────────────────────────────────────────

async function mixVideo(params: {
  videoPath:     string;
  narrationPath: string | null;
  musicPath:     string | null;
  outputPath:    string;
  targetFormat:  string;
}): Promise<string> {
  const { videoPath, narrationPath, musicPath, outputPath, targetFormat } = params;
  const dims = FORMAT_DIMS[targetFormat] ?? FORMAT_DIMS.linkedin;

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(videoPath)
      .videoFilters(`scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`);

    if (narrationPath && musicPath) {
      cmd = cmd
        .input(narrationPath)
        .input(musicPath)
        .complexFilter([
          "[1:a]volume=1.0[narr]",
          "[2:a]volume=0.15[bg]",
          "[narr][bg]amix=inputs=2:duration=first[aout]",
        ])
        .outputOptions(["-map 0:v", "-map [aout]"]);
    } else if (narrationPath) {
      cmd = cmd.input(narrationPath).outputOptions(["-map 0:v", "-map 1:a"]);
    } else if (musicPath) {
      cmd = cmd.input(musicPath)
        .complexFilter(["[1:a]volume=0.3[aout]"])
        .outputOptions(["-map 0:v", "-map [aout]", "-shortest"]);
    }

    cmd
      .outputOptions(["-c:v libx264", "-c:a aac", "-movflags +faststart", "-pix_fmt yuv420p"])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .run();
  });
}

// ── Step 4: Upload to Supabase Storage ────────────────────────────────────────

async function uploadToStorage(
  localPath: string,
  jobId:     string,
  format:    string,
): Promise<string> {
  const sb   = getSupabase();
  const data = await readFile(localPath);
  const key  = `demoforge/${format}/${jobId}.mp4`;

  const { error } = await sb.storage
    .from("vantage-media")
    .upload(key, data, { contentType: "video/mp4", upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = sb.storage.from("vantage-media").getPublicUrl(key);
  return urlData.publicUrl;
}

// ── Top-level processor ───────────────────────────────────────────────────────

export async function processJob(
  job:          DemoJob,
  onStatus:     (status: JobStatus) => Promise<void>,
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "demoforge-"));

  try {
    // 1. Record browser
    await onStatus("recording");
    const videoPath = await recordBrowser(job, workDir);

    // 2. Synthesize narration (may be null if no narration steps)
    await onStatus("synthesizing");
    let narrationPath: string | null = null;
    if (process.env.ELEVENLABS_API_KEY) {
      narrationPath = await synthesizeNarration(job, workDir).catch((e) => {
        console.warn("[demoforge] ElevenLabs synthesis failed, continuing without audio:", e.message);
        return null;
      });
    }

    // 3. Optional background music from Supabase Storage
    let musicPath: string | null = null;
    if (job.input_payload.music_track_id) {
      const sb = getSupabase();
      const { data: track } = await sb.from("music_tracks")
        .select("storage_path").eq("id", job.input_payload.music_track_id).single();
      if (track?.storage_path) {
        const { data: musicData } = await sb.storage.from("vantage-media")
          .download(track.storage_path as string);
        if (musicData) {
          const musicFilePath = join(workDir, "music.mp3");
          await writeFile(musicFilePath, Buffer.from(await musicData.arrayBuffer()));
          musicPath = musicFilePath;
        }
      }
    }

    // 4. Mix
    await onStatus("mixing");
    const outputPath = join(workDir, "output.mp4");
    await mixVideo({
      videoPath,
      narrationPath,
      musicPath,
      outputPath,
      targetFormat: job.target_format,
    });

    // 5. Upload
    const publicUrl = await uploadToStorage(outputPath, job.id, job.target_format);
    return publicUrl;
  } finally {
    // Clean up temp files
    const { rm } = await import("node:fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
