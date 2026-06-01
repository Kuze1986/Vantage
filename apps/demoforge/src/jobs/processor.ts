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
    const recording = await page.video()?.path();
    await page.close();
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
    voice:    voiceId,
    text:     narrations,
    model_id: "eleven_multilingual_v2",
    stream:   true,
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const audioPath = join(workDir, "narration.mp3");
  await writeFile(audioPath, Buffer.concat(chunks));
  return audioPath;
}

// ── Sound effect processing ──────────────────────────────────────────────────

/**
 * Generate silence-padded audio for a sound effect.
 * Prepends silence so the effect fires at the correct time in the video.
 * Returns the path to the padded audio file.
 */
async function generatePaddedEffect(params: {
  effectPath: string;
  delayMs: number;
  workDir: string;
  outputIndex: number;
}): Promise<string> {
  const { effectPath, delayMs, workDir, outputIndex } = params;
  const outputPath = join(workDir, `effect-${outputIndex}-padded.mp3`);

  return new Promise((resolve, reject) => {
    if (delayMs <= 0) {
      // No padding needed — just use the effect as-is
      resolve(effectPath);
      return;
    }

    // Generate silence + effect: use FFmpeg's concat demuxer
    // Create a silence file, then concat [silence, effect]
    const silencePath = join(workDir, `effect-${outputIndex}-silence.mp3`);
    const silenceDurationSec = (delayMs / 1000).toFixed(2);

    // First, generate the silence file
    ffmpeg()
      .input(`anullsrc=r=44100:cl=mono`)
      .inputFormat("lavfi")
      .inputOptions([`-t ${silenceDurationSec}`])
      .outputOptions(["-q:a 9"])
      .output(silencePath)
      .on("end", () => {
        // Now concat silence + effect
        const concatList = `ffconcat version 1.0
file '${silencePath}'
file '${effectPath}'`;
        const concatPath = join(workDir, `effect-${outputIndex}-concat.txt`);
        writeFile(concatPath, concatList).then(() => {
          ffmpeg()
            .input(`concat:${concatPath}`)
            .inputOptions(["-safe 0"])
            .outputOptions(["-c copy"])
            .output(outputPath)
            .on("end", () => resolve(outputPath))
            .on("error", reject)
            .run();
        }).catch(reject);
      })
      .on("error", reject)
      .run();
  });
}

// ── Step 3: FFmpeg mix ────────────────────────────────────────────────────────

async function mixVideo(params: {
  videoPath:     string;
  narrationPath: string | null;
  musicPath:     string | null;
  effectPaths:   string[];
  outputPath:    string;
  targetFormat:  string;
  narrationVolume?: number;
  musicVolume?: number;
  effectVolumes?: number[];
  masterVolume?: number;
}): Promise<string> {
  const {
    videoPath, narrationPath, musicPath, effectPaths, outputPath, targetFormat,
    narrationVolume = 100, musicVolume = 15, effectVolumes = [], masterVolume = 100
  } = params;
  const dims = FORMAT_DIMS[targetFormat] ?? FORMAT_DIMS.linkedin;

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(videoPath)
      .videoFilters(`scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`);

    // Build list of audio inputs and filter chain
    let audioInputCount = 0;
    const filters: string[] = [];
    const audioStreams: string[] = [];

    // Input 1: Narration (if present)
    if (narrationPath) {
      cmd = cmd.input(narrationPath);
      const narVolume = (narrationVolume / 100).toFixed(3);
      const narLabel = `[narr]`;
      filters.push(`[${audioInputCount}:a]volume=${narVolume}${narLabel}`);
      audioStreams.push(narLabel);
      audioInputCount++;
    }

    // Input 2+: Music (if present)
    if (musicPath) {
      cmd = cmd.input(musicPath);
      const musVolume = (musicVolume / 100).toFixed(3);
      const musLabel = `[mus]`;
      filters.push(`[${audioInputCount}:a]volume=${musVolume}${musLabel}`);
      audioStreams.push(musLabel);
      audioInputCount++;
    }

    // Input N: Sound effects (already silence-padded)
    for (let i = 0; i < effectPaths.length; i++) {
      cmd = cmd.input(effectPaths[i]);
      const effVolume = ((effectVolumes[i] ?? 80) / 100).toFixed(3);
      const effLabel = `[eff${i}]`;
      filters.push(`[${audioInputCount}:a]volume=${effVolume}${effLabel}`);
      audioStreams.push(effLabel);
      audioInputCount++;
    }

    // Build amix filter if we have audio tracks
    if (audioStreams.length > 0) {
      const masterVol = (masterVolume / 100).toFixed(3);
      const streamConcat = audioStreams.join("");
      filters.push(`${streamConcat}amix=inputs=${audioStreams.length}:duration=first[amixed]`);
      filters.push(`[amixed]volume=${masterVol}[aout]`);

      cmd = cmd.complexFilter(filters)
        .outputOptions(["-map 0:v", "-map [aout]", "-shortest"]);
    } else {
      // No audio — just use video
      cmd = cmd.outputOptions(["-map 0:v"]);
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

  // Try public URL first (works when bucket is public = true)
  const { data: urlData } = sb.storage.from("vantage-media").getPublicUrl(key);
  if (urlData?.publicUrl) return urlData.publicUrl;

  // Fallback: signed URL valid for 7 days (works on private buckets)
  const { data: signedData, error: signErr } = await sb.storage
    .from("vantage-media")
    .createSignedUrl(key, 60 * 60 * 24 * 7);
  if (signErr || !signedData?.signedUrl) {
    throw new Error(`Failed to generate download URL: ${signErr?.message ?? "unknown"}`);
  }
  return signedData.signedUrl;
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
    const hasNarration = job.input_payload.script.some((s) => s.narration.trim().length > 0);
    if (hasNarration && !process.env.ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not configured — cannot synthesize narration audio");
    }
    if (hasNarration && process.env.ELEVENLABS_API_KEY) {
      narrationPath = await synthesizeNarration(job, workDir);
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

    // 3.5. Sound effects from Supabase Storage (with silence padding)
    const effectPaths: string[] = [];
    const effectVolumes: number[] = [];
    const effectSteps = job.input_payload.script.filter((s) => s.soundEffect);

    for (let i = 0; i < effectSteps.length; i++) {
      const step = effectSteps[i];
      if (!step.soundEffect) continue;

      const sb = getSupabase();
      const { data: effect } = await sb.from("sound_effects")
        .select("storage_path").eq("id", step.soundEffect.effectId).single();

      if (effect?.storage_path) {
        const { data: effectData } = await sb.storage.from("vantage-media")
          .download(effect.storage_path as string);

        if (effectData) {
          const effectFilePath = join(workDir, `effect-${i}.mp3`);
          await writeFile(effectFilePath, Buffer.from(await effectData.arrayBuffer()));

          // Generate silence-padded version
          const paddedPath = await generatePaddedEffect({
            effectPath: effectFilePath,
            delayMs: step.soundEffect.delayMs,
            workDir,
            outputIndex: i,
          });

          effectPaths.push(paddedPath);
          effectVolumes.push(step.soundEffect.volumePercent);
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
      effectPaths,
      outputPath,
      targetFormat: job.target_format,
      narrationVolume: job.input_payload.narration_volume ?? 100,
      musicVolume: job.input_payload.music_volume ?? 15,
      effectVolumes,
      masterVolume: job.input_payload.master_volume ?? 100,
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
