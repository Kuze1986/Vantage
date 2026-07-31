/**
 * Core DemoForge pipeline:
 *   1. Record browser session with Playwright (screen recording)
 *   2. Synthesize narration audio via a pluggable TTS provider (ElevenLabs or Voicebox)
 *   3. Mix video + audio + background music + overlays via FFmpeg
 *   4. Upload to Supabase Storage → return public URL
 */
import { chromium } from "playwright";
import { ElevenLabsClient } from "elevenlabs";
import ffmpeg from "fluent-ffmpeg";

// On Windows, winget installs FFmpeg outside the inherited PATH of long-running processes.
// Set the path explicitly so fluent-ffmpeg can find the binary without a shell restart.
if (process.platform === "win32") {
  const wingetFfmpeg = `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe`;
  ffmpeg.setFfmpegPath(wingetFfmpeg);
  ffmpeg.setFfprobePath(wingetFfmpeg.replace("ffmpeg.exe", "ffprobe.exe"));
}
import { createClient } from "@supabase/supabase-js";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DemoJob, JobStatus, ScriptStep, OverlayConfig, CaptionConfig, WordTiming, ColorGradeConfig, ColorGradePreset, TimelineConfig } from "./queue.js";

// Platform video dimensions
const FORMAT_DIMS: Record<string, { width: number; height: number }> = {
  tiktok:    { width: 1080, height: 1920 },
  instagram: { width: 1080, height: 1920 },
  linkedin:  { width: 1920, height: 1080 },
};

// Font paths: Windows dev vs Linux production (Railway/Docker)
// On Linux, install fonts-dejavu-core package (or equivalent) in the Dockerfile.
const FONT_PATHS: Record<"mono" | "sans" | "display", string> = process.platform === "win32"
  ? {
      mono:    "C\\:/Windows/Fonts/consola.ttf",
      sans:    "C\\:/Windows/Fonts/arial.ttf",
      display: "C\\:/Windows/Fonts/trebuc.ttf",
    }
  : {
      mono:    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
      sans:    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      display: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
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

// Raised by VoiceBoxProvider when the server is reachable but the model isn't
// loaded yet — treated as a graceful "produce silent video" case downstream.
class VoiceboxNotReadyError extends Error {}

// ── Step 1: Browser recording ─────────────────────────────────────────────────

async function recordBrowser(
  job: DemoJob,
  workDir: string,
): Promise<string> {
  const dims = FORMAT_DIMS[job.target_format] ?? FORMAT_DIMS.linkedin;
  const videoPath = join(workDir, "screen.webm");

  const browser = await chromium.launch({ headless: true });
  // Record at the full platform size (e.g. 1080×1920 for TikTok). Previously height was
  // clamped to 1080, then FFmpeg padded to 9:16 — leaving huge black bars around a square.
  const context = await browser.newContext({
    viewport: { width: dims.width, height: dims.height },
    recordVideo: { dir: workDir, size: { width: dims.width, height: dims.height } },
    colorScheme: "dark",
    // Match Shift's dark canvas so about:blank / early paint isn't a white flash.
    deviceScaleFactor: 1,
  });
  // Paint dark backgrounds as soon as any document is created (covers FOUC before CSS).
  await context.addInitScript(`(function(){
    try {
      var s = document.createElement('style');
      s.textContent = 'html,body{background:#070b14!important;color-scheme:dark}';
      (document.head || document.documentElement).appendChild(s);
      if (document.documentElement) document.documentElement.style.background = '#070b14';
      if (document.body) document.body.style.background = '#070b14';
    } catch (e) {}
  })()`);
  // Any "eval" steps that set sessionStorage/localStorage need to run before
  // React mounts on each navigation, not just once via page.evaluate().
  // addInitScript registers a snippet that fires at document creation time on
  // every navigation within this context.
  const evalSteps = job.input_payload.script.filter((s) => s.action === "eval" && s.selector);
  for (const step of evalSteps) {
    const code = step.selector!;
    await context.addInitScript(`(function(){ try{ ${code} }catch(e){} })()`);
  }

  const page = await context.newPage();

  try {
    // Replace Playwright's default white about:blank with a dark frame before the script runs.
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        html,body{margin:0;width:100%;height:100%;background:#070b14;color-scheme:dark}
      </style></head><body></body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForTimeout(250);

    for (const step of job.input_payload.script) {
      await executeStep(page, step);
    }
    // Brief pause at the end so last state is visible
    await page.waitForTimeout(1500);
  } finally {
    // Grab the video reference BEFORE closing the page.
    const video = page.video();
    // Close page then context — context.close() finalizes the recording on disk.
    await page.close();
    await context.close();
    // saveAs must happen after context.close() (video finalized) but BEFORE browser.close().
    if (video) {
      await video.saveAs(videoPath);
    }
    await browser.close();
  }

  // Verify the recording exists before handing it to the mix phase.
  const { stat } = await import("node:fs/promises");
  const info = await stat(videoPath).catch(() => null);
  if (!info || info.size === 0) {
    throw new Error(`Browser recording not found or empty at ${videoPath}`);
  }
  console.log(`[demoforge] recorded ${(info.size / 1024).toFixed(0)} KB → ${videoPath}`);

  return videoPath;
}

async function executeStep(
  page: import("playwright").Page,
  step: ScriptStep,
): Promise<void> {
  switch (step.action) {
    case "eval":
      // Handled via addInitScript before navigation — no runtime action.
      break;
    case "run":
      if (step.selector?.trim()) {
        const expr = step.selector.trim();
        if (expr.includes("__shiftDemoPlay")) {
          // Wait for the specific helper (e.g. playDossierRound), not just the object —
          // production Shift only exposes handlers when auth-bypass / DEMO_RECORDING is on.
          const methodMatch = /__shiftDemoPlay\.([a-zA-Z0-9_]+)/.exec(expr);
          const method = methodMatch?.[1];
          const ready = await page.waitForFunction(
            (name) => {
              const api = (window as unknown as { __shiftDemoPlay?: Record<string, unknown> }).__shiftDemoPlay;
              if (!api || typeof api !== "object") return false;
              return !name || typeof api[name] === "function";
            },
            method ?? "",
            { timeout: 25_000 },
          ).then(() => true).catch(() => false);
          if (!ready) {
            const path = page.url();
            console.warn(
              `[demoforge] run skipped — __shiftDemoPlay${method ? `.${method}` : ""} not available at ${path}. ` +
                "Likely stuck on login or Shift production missing demo-recording/auth-bypass exposure.",
            );
            if (step.ms) await page.waitForTimeout(step.ms);
            break;
          }
        }
        try {
          await page.evaluate(async (code) => {
            // Demo script snippets come from trusted portfolio templates only.
            // eslint-disable-next-line no-eval
            const result = eval(code);
            if (result != null && typeof (result as Promise<unknown>).then === "function") {
              await result;
            }
          }, expr);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[demoforge] run step failed (continuing): ${msg.slice(0, 300)}`);
        }
      }
      if (step.ms) await page.waitForTimeout(step.ms);
      break;
    case "navigate": {
      // URL is stored in selector (as set by DemoForgePage.tsx); fall back to text
      const target = step.selector ?? step.text ?? "";
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      // Live Shift requires auth. DemoForge sets sessionStorage bypass via eval/init scripts;
      // if we still landed on /login, re-assert and retry once.
      if (/\/login(?:[/?#]|$)/i.test(page.url()) && target) {
        await page.evaluate(() => {
          try {
            sessionStorage.setItem("the_shift_auth_bypass_mode", "admin");
          } catch { /* ignore */ }
        });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        if (/\/login(?:[/?#]|$)/i.test(page.url())) {
          console.warn(`[demoforge] still on login after auth-bypass retry: ${page.url()}`);
        }
      }
      // Settle past the initial white/cream paint so the first usable frames are the dark UI.
      await page.waitForFunction(
        () => ((document.body?.innerText || "").trim().length > 40),
        undefined,
        { timeout: 8_000 },
      ).catch(() => undefined);
      await page.waitForTimeout(400);
      if (step.ms) await page.waitForTimeout(step.ms);
      break;
    }
    case "click":
      if (step.selector) {
        // Wait for the element to appear (handles async-rendered content) before clicking
        await page.waitForSelector(step.selector, { timeout: 10_000 }).catch(() => undefined);
        await page.click(step.selector, { timeout: 5_000 }).catch(() => undefined);
      }
      if (step.ms) await page.waitForTimeout(step.ms);
      break;
    case "fill":
      if (step.selector && step.text) await page.fill(step.selector, step.text);
      if (step.ms) await page.waitForTimeout(step.ms);
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 1000);
      break;
    case "scroll":
      await page.evaluate(() => window.scrollBy(0, 300));
      if (step.ms) await page.waitForTimeout(step.ms);
      break;
    case "narrate":
      // Pause to let narration play in final mix — just wait here
      await page.waitForTimeout(step.ms ?? 2000);
      break;
  }
}

// ── Step 2: Voice synthesis (pluggable TTS provider) ──────────────────────────

const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel — Steady Broadcaster (premade, free tier)
const NARRATION_STEP_PAD_MS = 400; // visual hold after each spoken line

type NarrationResult = { audioPath: string; wordTimings: WordTiming[]; script: ScriptStep[] };
type LineNarration = { audioPath: string; durationSec: number; wordTimings: WordTiming[] };

function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration ?? 0);
    });
  });
}

/**
 * A TTS backend. `synthesizeLine` renders one narration line to an audio file on
 * disk and returns its duration plus per-word timings used for auto-captions.
 * `prepare()` runs once before the first line (e.g. readiness checks).
 */
interface TtsProvider {
  readonly name: string;
  prepare?(): Promise<void>;
  synthesizeLine(text: string, workDir: string, index: number): Promise<LineNarration>;
}

// ── ElevenLabs provider (cloud) ───────────────────────────────────────────────
// Returns real character-level timings, converted to word timings for captions.
class ElevenLabsProvider implements TtsProvider {
  readonly name = "elevenlabs";
  constructor(private readonly voiceId: string) {}

  async synthesizeLine(text: string, workDir: string, index: number): Promise<LineNarration> {
    const el = getElevenLabs();
    const result = await el.textToSpeech.convertWithTimestamps(this.voiceId, {
      text,
      model_id: "eleven_turbo_v2_5",
    });

    const audioPath = join(workDir, `narr-line-${index}.mp3`);
    const audioBytes = Buffer.from(result.audio_base64, "base64");
    if (audioBytes.length === 0) throw new Error("ElevenLabs returned empty audio");
    await writeFile(audioPath, audioBytes);

    const durationSec = await getMediaDuration(audioPath);
    const alignment = result.alignment ?? result.normalized_alignment;
    const wordTimings = alignment
      ? charAlignmentToWordTimings(
          alignment.characters,
          alignment.character_start_times_seconds,
          alignment.character_end_times_seconds,
        )
      : [];

    return { audioPath, durationSec: durationSec > 0 ? durationSec : 1, wordTimings };
  }
}

// ── Voicebox provider (local, self-hosted Qwen3-TTS) ──────────────────────────
// Voicebox returns audio + duration but no word timings, so captions use an
// even-distribution approximation (see evenWordTimings). Voices are "profiles".
class VoiceBoxProvider implements TtsProvider {
  readonly name = "voicebox";
  private readonly baseUrl: string;
  private readonly profileId: string;
  private readonly engine?: string;
  private readonly language: string;

  constructor() {
    this.baseUrl = (process.env.VOICEBOX_API_URL ?? "http://127.0.0.1:17493").replace(/\/+$/, "");
    const profileId = process.env.VOICEBOX_PROFILE_ID;
    if (!profileId) throw new VoiceboxNotReadyError("Missing VOICEBOX_PROFILE_ID (pick a voice profile via GET /profiles)");
    this.profileId = profileId;
    this.engine = process.env.VOICEBOX_ENGINE || undefined;
    this.language = process.env.VOICEBOX_LANGUAGE || "en";
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** Verify the server is up and a model is loaded before synthesizing. */
  async prepare(): Promise<void> {
    let health: { status?: string; model_loaded?: boolean };
    try {
      const res = await fetch(this.url("/health"));
      if (!res.ok) throw new Error(`health ${res.status}`);
      health = (await res.json()) as { status?: string; model_loaded?: boolean };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VoiceboxNotReadyError(`Voicebox server unreachable at ${this.baseUrl} (${msg})`);
    }
    if (!health.model_loaded) {
      throw new VoiceboxNotReadyError(
        "Voicebox model not loaded — open the Voicebox app and download/load a model (GET /health → model_loaded:false)",
      );
    }
  }

  async synthesizeLine(text: string, workDir: string, index: number): Promise<LineNarration> {
    // 1. Kick off generation.
    const genRes = await fetch(this.url("/generate"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile_id: this.profileId,
        text,
        language: this.language,
        ...(this.engine ? { engine: this.engine } : {}),
      }),
    });
    if (!genRes.ok) throw new Error(`Voicebox /generate failed: ${genRes.status} ${await genRes.text()}`);
    const gen = (await genRes.json()) as { id: string; status?: string; duration?: number | null };

    // 2. Poll until terminal (bounded).
    const status = await this.waitForCompletion(gen.id, gen.status);

    // 3. Download the rendered audio bytes.
    const audioRes = await fetch(this.url(`/audio/${gen.id}`));
    if (!audioRes.ok) throw new Error(`Voicebox /audio/${gen.id} failed: ${audioRes.status}`);
    const audioBytes = Buffer.from(await audioRes.arrayBuffer());
    if (audioBytes.length === 0) throw new Error("Voicebox returned empty audio");
    const audioPath = join(workDir, `narr-line-${index}.wav`);
    await writeFile(audioPath, audioBytes);

    // 4. Duration from the API when available, else probe the file.
    let durationSec = status.duration ?? gen.duration ?? 0;
    if (!durationSec || durationSec <= 0) durationSec = await getMediaDuration(audioPath);
    durationSec = durationSec > 0 ? durationSec : 1;

    // 5. Approximate word timings (Voicebox provides none).
    return { audioPath, durationSec, wordTimings: evenWordTimings(text, durationSec) };
  }

  private async waitForCompletion(
    id: string,
    initialStatus?: string,
  ): Promise<{ status: string; duration?: number | null }> {
    const terminal = (s?: string) => s === "completed" || s === "failed" || s === "error";
    if (terminal(initialStatus)) {
      if (initialStatus !== "completed") throw new Error(`Voicebox generation ${initialStatus}`);
      return { status: initialStatus };
    }
    const deadline = Date.now() + 120_000; // 2 min ceiling (CPU synthesis is slow)
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 750));
      const res = await fetch(this.url(`/generate/${id}/status`));
      if (!res.ok) continue;
      const body = (await res.json()) as { status?: string; duration?: number | null };
      if (terminal(body.status)) {
        if (body.status !== "completed") throw new Error(`Voicebox generation ${body.status}`);
        return { status: "completed", duration: body.duration };
      }
    }
    throw new Error(`Voicebox generation ${id} timed out`);
  }
}

/**
 * Distribute word timings evenly across a line's known duration, weighting each
 * word by its character length so longer words linger. Used when the TTS
 * provider (Voicebox) does not return real alignment data.
 */
function evenWordTimings(text: string, durationSec: number): WordTiming[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const timings: WordTiming[] = [];
  let cursor = 0;
  for (const word of words) {
    const span = (word.length / totalChars) * durationSec;
    timings.push({ word, start_sec: cursor, end_sec: cursor + span });
    cursor += span;
  }
  return timings;
}

async function concatAudioClips(
  clipPaths: string[],
  workDir: string,
): Promise<string> {
  if (clipPaths.length === 0) throw new Error("No audio clips to concat");
  if (clipPaths.length === 1) return clipPaths[0];

  const outPath = join(workDir, "narration.mp3");
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    for (const p of clipPaths) cmd = cmd.input(p);
    const inputs = clipPaths.map((_, i) => `[${i}:a]`).join("");
    cmd
      .complexFilter([`${inputs}concat=n=${clipPaths.length}:v=0:a=1[aout]`])
      .outputOptions(["-map [aout]"])
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

/**
 * Synthesize each script line separately, then set step `ms` to match speech
 * duration so the recording stays in sync with narration.
 */
async function prepareScriptWithSyncedNarration(
  script: ScriptStep[],
  workDir: string,
  provider: TtsProvider,
): Promise<NarrationResult> {
  const timedScript: ScriptStep[] = [];
  const audioClips: string[] = [];
  const allWordTimings: WordTiming[] = [];
  let timelineOffsetSec = 0;
  let lineIndex = 0;

  await provider.prepare?.();

  for (const step of script) {
    if (step.action === "eval") {
      timedScript.push(step);
      continue;
    }

    const narration = step.narration?.trim() ?? "";
    let ms = step.ms ?? 1000;

    if (narration.length > 0) {
      const line = await provider.synthesizeLine(narration, workDir, lineIndex++);
      ms = Math.max(Math.ceil(line.durationSec * 1000) + NARRATION_STEP_PAD_MS, 800);
      audioClips.push(line.audioPath);

      for (const w of line.wordTimings) {
        allWordTimings.push({
          word: w.word,
          start_sec: w.start_sec + timelineOffsetSec,
          end_sec: w.end_sec + timelineOffsetSec,
        });
      }
      timelineOffsetSec += line.durationSec + NARRATION_STEP_PAD_MS / 1000;
    } else {
      timelineOffsetSec += ms / 1000;
    }

    timedScript.push({ ...step, ms });
  }

  const audioPath = await concatAudioClips(audioClips, workDir);
  console.log(
    `[demoforge] synced narration: ${audioClips.length} lines, ~${timelineOffsetSec.toFixed(1)}s, ` +
    `${timedScript.reduce((s, st) => s + (st.ms ?? 0), 0)}ms recording budget`,
  );

  return { audioPath, wordTimings: allWordTimings, script: timedScript };
}

function charAlignmentToWordTimings(
  characters: string[],
  startTimes: number[],
  endTimes: number[],
): WordTiming[] {
  const timings: WordTiming[] = [];
  let wordChars = "";
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === " " || ch === "\n" || ch === "\r") {
      if (wordChars.trim()) {
        timings.push({ word: wordChars, start_sec: wordStart, end_sec: wordEnd });
      }
      wordChars = "";
    } else {
      if (!wordChars) wordStart = startTimes[i];
      wordEnd = endTimes[i];
      wordChars += ch;
    }
  }
  if (wordChars.trim()) {
    timings.push({ word: wordChars, start_sec: wordStart, end_sec: wordEnd });
  }
  return timings;
}

function getTtsProvider(job: DemoJob): TtsProvider {
  const choice = job.input_payload.tts_provider ?? process.env.DEMOFORGE_TTS_PROVIDER ?? "elevenlabs";
  if (choice === "voicebox") return new VoiceBoxProvider();
  return new ElevenLabsProvider(job.input_payload.voice_id ?? DEFAULT_VOICE_ID);
}

async function synthesizeNarration(
  job: DemoJob,
  workDir: string,
): Promise<NarrationResult | null> {
  const hasLines = job.input_payload.script.some((s) => s.narration?.trim().length > 0);
  if (!hasLines) return null;

  const choice = job.input_payload.tts_provider ?? process.env.DEMOFORGE_TTS_PROVIDER ?? "elevenlabs";
  if (choice !== "voicebox" && !process.env.ELEVENLABS_API_KEY?.trim()) {
    console.warn(
      "[demoforge] ELEVENLABS_API_KEY missing on this service — producing silent video. " +
        "Set ELEVENLABS_API_KEY (or DEMOFORGE_TTS_PROVIDER=voicebox) on the DemoForge Railway service.",
    );
    return null;
  }

  try {
    const provider = getTtsProvider(job);
    return await prepareScriptWithSyncedNarration(job.input_payload.script, workDir, provider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ElevenLabs out of credits → produce a silent video rather than failing the job.
    if (msg.includes("402") || msg.toLowerCase().includes("payment")) {
      console.warn("[demoforge] ElevenLabs 402 — out of credits, producing silent video");
      return null;
    }
    if (msg.includes("ELEVENLABS_API_KEY") || msg.includes("Missing ELEVENLABS")) {
      console.warn(`[demoforge] ElevenLabs not configured — producing silent video: ${msg}`);
      return null;
    }
    // Voicebox unreachable / model not loaded → same graceful degradation.
    if (err instanceof VoiceboxNotReadyError) {
      console.warn(`[demoforge] Voicebox unavailable — producing silent video: ${msg}`);
      return null;
    }
    throw err;
  }
}

// ── Phase 2: Caption (ASS subtitle) generation ───────────────────────────────

function hexToAssColor(hex: string, alphaHex = "00"): string {
  // ASS colors are &HAABBGGRR (alpha, blue, green, red — each 2 hex digits)
  const h = hex.replace(/^#/, "").padStart(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function formatAssTime(secs: number): string {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeFilterPath(p: string): string {
  return p
    .replace(/\\/g, "/")     // normalize to forward slashes
    .replace(/:/g, "\\:")     // escape colons (including Windows drive letter)
    .replace(/'/g, "\\'");    // escape single quotes
}

async function generateCaptionASS(
  wordTimings: WordTiming[],
  captionConfig: CaptionConfig,
  targetFormat: string,
  workDir: string,
): Promise<string> {
  const isPortrait = targetFormat !== "linkedin";
  const playResX = isPortrait ? 1080 : 1920;
  const playResY = isPortrait ? 1920 : 1080;

  const fontSize      = captionConfig.font_size ?? (isPortrait ? 56 : 40);
  const fontName      = captionConfig.font_family === "mono" ? "Courier New" : "Arial";
  const primaryColor  = hexToAssColor(captionConfig.primary_color ?? "#FFFFFF");
  const secondaryColor = hexToAssColor(captionConfig.highlight_color ?? "#FFFF00"); // karaoke highlight
  const outlineColor  = hexToAssColor(captionConfig.outline_color ?? "#000000");
  const backColor     = captionConfig.background ? "&H80000000" : "&H00000000";
  const borderStyle   = captionConfig.background ? 3 : 1;  // 3 = opaque box, 1 = outline+shadow
  const outline       = captionConfig.background ? 0 : 2;
  const maxWords      = captionConfig.max_words_per_line ?? (isPortrait ? 4 : 6);
  const marginV       = 60;

  // Alignment: 2=bottom-center, 8=top-center, 5=center
  let alignment = 2;
  if (captionConfig.position === "top")    alignment = 8;
  if (captionConfig.position === "center") alignment = 5;

  // Group words into lines
  const lines: WordTiming[][] = [];
  for (let i = 0; i < wordTimings.length; i += maxWords) {
    lines.push(wordTimings.slice(i, i + maxWords));
  }

  const dialogueLines: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    const start = formatAssTime(line[0].start_sec);
    const end   = formatAssTime(line[line.length - 1].end_sec);

    let text: string;
    if (captionConfig.word_highlight) {
      // Karaoke-style: each word has a \kf tag with its duration in centiseconds
      text = line.map((w) => {
        const durationCs = Math.max(1, Math.round((w.end_sec - w.start_sec) * 100));
        return `{\\kf${durationCs}}${w.word}`;
      }).join(" ");
    } else {
      text = line.map((w) => w.word).join(" ");
    }

    dialogueLines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }

  const assContent = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${primaryColor},${secondaryColor},${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},0,${alignment},10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogueLines,
  ].join("\n");

  const assPath = join(workDir, "captions.ass");
  await writeFile(assPath, assContent, "utf-8");
  return assPath;
}

// ── Sound effect processing ──────────────────────────────────────────────────

/**
 * Generate silence-padded audio for a sound effect.
 * Prepends silence so the effect fires at the correct time in the video.
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
      resolve(effectPath);
      return;
    }

    const silencePath = join(workDir, `effect-${outputIndex}-silence.mp3`);
    const silenceDurationSec = (delayMs / 1000).toFixed(2);

    ffmpeg()
      .input(`anullsrc=r=44100:cl=mono`)
      .inputFormat("lavfi")
      .inputOptions([`-t ${silenceDurationSec}`])
      .outputOptions(["-q:a 9"])
      .output(silencePath)
      .on("end", () => {
        const concatList = `ffconcat version 1.0\nfile '${silencePath}'\nfile '${effectPath}'`;
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

// ── Phase 1: Video overlay helpers ───────────────────────────────────────────

function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

function resolveX(x: OverlayConfig["x"], xOffset: number, isText: boolean): string {
  if (x === "left")   return `${xOffset}`;
  if (x === "right")  return isText ? `w-text_w-${xOffset}` : `W-w-${xOffset}`;
  if (x === "center") return isText ? `(w-text_w)/2` : `(W-w)/2`;
  return String(x);
}

function resolveY(y: OverlayConfig["y"], yOffset: number, isText: boolean): string {
  if (y === "top")    return `${yOffset}`;
  if (y === "bottom") return isText ? `h-text_h-${yOffset}` : `H-h-${yOffset}`;
  if (y === "center") return isText ? `(h-text_h)/2` : `(H-h)/2`;
  return String(y);
}

function buildTextOverlayFilter(
  overlay: OverlayConfig,
  inputLabel: string,
  outputLabel: string,
): string {
  const fontFamily = overlay.font_family ?? "sans";
  const fontPath   = FONT_PATHS[fontFamily];
  const fontSize   = overlay.font_size ?? 48;
  const fontColor  = (overlay.font_color ?? "#FFFFFF").replace(/^#/, "0x");
  const xOffset    = overlay.x_offset ?? 20;
  const yOffset    = overlay.y_offset ?? 20;
  const x = resolveX(overlay.x, xOffset, true);
  const y = resolveY(overlay.y, yOffset, true);
  const text = escapeDrawtext(overlay.content ?? "");
  const box = overlay.box_color
    ? `:box=1:boxcolor=${overlay.box_color.replace(/^#/, "0x")}:boxborderw=10`
    : "";
  const enable = (overlay.start_sec !== undefined || overlay.end_sec !== undefined)
    ? `:enable='between(t,${overlay.start_sec ?? 0},${overlay.end_sec ?? 9999})'`
    : "";

  return `${inputLabel}drawtext=fontfile=${fontPath}:text='${text}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}${box}${enable}${outputLabel}`;
}

/**
 * Returns 1 or 2 filter fragments (split by ";") for image overlays.
 * Two fragments are returned when width scaling is needed.
 */
function buildImageOverlayFilter(
  overlay: OverlayConfig,
  videoLabel: string,
  logoLabel: string,
  outputLabel: string,
): string {
  const xOffset = overlay.x_offset ?? 20;
  const yOffset = overlay.y_offset ?? 20;
  const x = resolveX(overlay.x, xOffset, false);
  const y = resolveY(overlay.y, yOffset, false);
  const enable = (overlay.start_sec !== undefined || overlay.end_sec !== undefined)
    ? `:enable='between(t,${overlay.start_sec ?? 0},${overlay.end_sec ?? 9999})'`
    : "";

  if (overlay.width) {
    const scaledLabel = `[slogo_${outputLabel.slice(1, -1)}]`;
    return (
      `${logoLabel}scale=${overlay.width}:-1${scaledLabel};` +
      `${videoLabel}${scaledLabel}overlay=${x}:${y}${enable}${outputLabel}`
    );
  }

  return `${videoLabel}${logoLabel}overlay=${x}:${y}${enable}${outputLabel}`;
}

// ── Phase 3: Color grade filter builder ──────────────────────────────────────

type EqParams = { brightness?: number; contrast?: number; saturation?: number; gamma?: number };
type ColorbalanceParams = { rs?: number; gs?: number; bs?: number; rm?: number; gm?: number; bm?: number; rh?: number; gh?: number; bh?: number };

const PRESET_EQ: Record<ColorGradePreset, EqParams> = {
  clean:      {},
  warm:       { saturation: 1.3, gamma: 1.05 },
  cinematic:  { contrast: 1.3, saturation: 0.85, gamma: 0.9 },
  vibrant:    { saturation: 1.6, contrast: 1.1 },
  muted:      { saturation: 0.55, contrast: 0.9 },
  cool:       { saturation: 1.05, gamma: 0.95 },
  dark:       { brightness: -0.08, contrast: 1.2, gamma: 0.85 },
};

const PRESET_COLORBALANCE: Record<ColorGradePreset, ColorbalanceParams> = {
  clean:      {},
  warm:       { rh: 0.08, gh: -0.02, bh: -0.06 },
  cinematic:  { rs: -0.1, gs: 0.05, bs: 0.1, rh: 0.1, gh: 0.05, bh: -0.1 },
  vibrant:    {},
  muted:      {},
  cool:       { rs: -0.05, gs: 0.02, bs: 0.1, rh: -0.05, gh: 0.02, bh: 0.12 },
  dark:       {},
};

function buildColorGradeFilter(cfg: ColorGradeConfig, inLabel: string, outLabel: string): string | null {
  const preset = cfg.preset ?? "clean";
  const custom = cfg.custom ?? {};

  // Merge preset defaults with custom overrides
  const eq: EqParams = { ...PRESET_EQ[preset] };
  if (custom.brightness !== undefined) eq.brightness = custom.brightness;
  if (custom.contrast   !== undefined) eq.contrast   = custom.contrast;
  if (custom.saturation !== undefined) eq.saturation = custom.saturation;
  if (custom.gamma      !== undefined) eq.gamma      = custom.gamma;

  const cb: ColorbalanceParams = { ...PRESET_COLORBALANCE[preset] };
  if (custom.red_gain   !== undefined) { cb.rh = custom.red_gain;   cb.rm = custom.red_gain   * 0.5; }
  if (custom.green_gain !== undefined) { cb.gh = custom.green_gain; cb.gm = custom.green_gain * 0.5; }
  if (custom.blue_gain  !== undefined) { cb.bh = custom.blue_gain;  cb.bm = custom.blue_gain  * 0.5; }

  const hasEq = Object.keys(eq).length > 0;
  const hasCb = Object.keys(cb).length > 0;

  if (!hasEq && !hasCb) return null;

  const parts: string[] = [];

  if (hasEq) {
    const eqArgs = [
      eq.brightness !== undefined ? `brightness=${eq.brightness.toFixed(3)}`   : null,
      eq.contrast   !== undefined ? `contrast=${eq.contrast.toFixed(3)}`       : null,
      eq.saturation !== undefined ? `saturation=${eq.saturation.toFixed(3)}`   : null,
      eq.gamma      !== undefined ? `gamma=${eq.gamma.toFixed(3)}`             : null,
    ].filter(Boolean).join(":");
    parts.push(`eq=${eqArgs}`);
  }

  if (hasCb) {
    const cbArgs = (Object.entries(cb) as [string, number][])
      .map(([k, v]) => `${k}=${v.toFixed(3)}`).join(":");
    parts.push(`colorbalance=${cbArgs}`);
  }

  // Chain filters using vf-style comma separating inside the complex filter fragment
  return `${inLabel}${parts.join(",")}${outLabel}`;
}

// ── Phase 5: Timeline helpers ─────────────────────────────────────────────────

function applyTargetDuration(script: ScriptStep[], targetSec: number): ScriptStep[] {
  // Estimated duration = sum of all wait/navigate/click/fill/scroll step ms values
  const totalMs = script.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  if (totalMs <= 0) return script;

  const ratio = (targetSec * 1000) / totalMs;
  return script.map((s) =>
    s.ms !== undefined ? { ...s, ms: Math.max(16, Math.round(s.ms * ratio)) } : s,
  );
}

// FFmpeg atempo is clamped to 0.5–2.0; chain multiple filters for values outside that range.
function buildAtempoChain(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;

  if (speed >= 1) {
    while (remaining > 2.0 + 1e-9) {
      filters.push("atempo=2.0");
      remaining /= 2.0;
    }
    filters.push(`atempo=${remaining.toFixed(4)}`);
  } else {
    while (remaining < 0.5 - 1e-9) {
      filters.push("atempo=0.5");
      remaining /= 0.5;
    }
    filters.push(`atempo=${remaining.toFixed(4)}`);
  }

  return filters.join(",");
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
  // Phase 1: video overlays
  overlays?: OverlayConfig[];
  overlayLogoFiles?: (string | null)[];  // one entry per image overlay in order
  // Phase 2: captions
  captionPath?: string;
  // Phase 3: color grading
  colorGrade?: ColorGradeConfig;
  // Phase 5: timeline
  timeline?: TimelineConfig;
}): Promise<string> {
  const {
    videoPath, narrationPath, musicPath, effectPaths, outputPath, targetFormat,
    narrationVolume = 100, musicVolume = 15, effectVolumes = [], masterVolume = 100,
    overlays = [], overlayLogoFiles = [], captionPath, colorGrade, timeline,
  } = params;
  const dims = FORMAT_DIMS[targetFormat] ?? FORMAT_DIMS.linkedin;

  console.log(`[demoforge] mixing: video=${videoPath} narration=${narrationPath} music=${musicPath}`);

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(videoPath);
    const filters: string[] = [];

    // ── Video chain ────────────────────────────────────────────────────────
    const speed = timeline?.global_speed_multiplier ?? 1.0;
    const hasSpeed = Math.abs(speed - 1.0) > 0.001;
    const hasTrim  = (timeline?.trim_start_sec ?? 0) > 0 || (timeline?.trim_end_sec ?? 0) > 0;

    // Build trim fragment prepended to scale+pad (operates on raw source).
    let trimFragment = "";
    if (hasTrim) {
      const ts = timeline!.trim_start_sec ?? 0;
      const te = timeline!.trim_end_sec   ?? 0;
      // trim= takes absolute start/end, setpts resets timestamps after cut.
      const trimArgs = ts > 0 && te > 0
        ? `trim=start=${ts.toFixed(3)}:end=${te.toFixed(3)},setpts=PTS-STARTPTS,`
        : ts > 0
        ? `trim=start=${ts.toFixed(3)},setpts=PTS-STARTPTS,`
        : `trim=end=${te.toFixed(3)},setpts=PTS-STARTPTS,`;
      trimFragment = trimArgs;
    }

    // After scale+pad, apply speed (setpts). Speed <1 slows down, >1 speeds up.
    const hasOverlays = overlays.length > 0;
    // If speed is applied, scale first emits [vspeed_in], then speed emits [vscale] or [vout].
    const afterScale = hasSpeed
      ? "[vspeed_in]"
      : hasOverlays ? "[vscale]" : "[vout]";

    filters.push(
      `[0:v]${trimFragment}scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,` +
      `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2${afterScale}`
    );

    if (hasSpeed) {
      const speedOut = hasOverlays ? "[vscale]" : "[vout]";
      // setpts=PTS/speed: divides timestamps → speeds up; multiplies → slows down
      filters.push(`[vspeed_in]setpts=PTS/${speed.toFixed(4)}${speedOut}`);
    }

    // Logo inputs are added next (before audio) so their indices are stable.
    // Count image overlays to know how many logo inputs there will be.
    let nextInputIdx = 1; // input 0 is video
    const imageOverlayInputIndices: number[] = [];

    for (const ov of overlays) {
      if (ov.type === "image") {
        imageOverlayInputIndices.push(nextInputIdx);
        nextInputIdx++;
      }
    }

    // Add logo files as inputs now
    let imageOvCount = 0;
    for (const ov of overlays) {
      if (ov.type === "image") {
        const logoPath = overlayLogoFiles[imageOvCount] ?? null;
        if (logoPath) cmd = cmd.input(logoPath);
        else nextInputIdx--; // no actual input added — decrement to keep indices correct
        imageOvCount++;
      }
    }

    // Rebuild image overlay input indices accounting for missing logos
    const actualImageIndices: (number | null)[] = [];
    {
      let logoIdx = 1;
      let ioCount = 0;
      for (const ov of overlays) {
        if (ov.type === "image") {
          const hasLogo = !!(overlayLogoFiles[ioCount]);
          actualImageIndices.push(hasLogo ? logoIdx++ : null);
          ioCount++;
        }
      }
    }

    // Audio inputs start after all logo inputs
    const firstAudioIdx = 1 + actualImageIndices.filter((i) => i !== null).length;
    let audioInputCount = firstAudioIdx;
    const audioStreams: string[] = [];

    // Build overlay filter chain: [vscale]→[v0]→...→[vout]
    let lastVideoLabel = afterScale;
    let imgIdx = 0;
    for (let i = 0; i < overlays.length; i++) {
      const ov = overlays[i];
      const isLast = i === overlays.length - 1;
      const outLabel = isLast ? "[vout]" : `[vov${i}]`;

      if (ov.type === "text") {
        filters.push(buildTextOverlayFilter(ov, lastVideoLabel, outLabel));
      } else if (ov.type === "image") {
        const inputIdx = actualImageIndices[imgIdx];
        imgIdx++;
        if (inputIdx !== null) {
          const logoLabel = `[${inputIdx}:v]`;
          const frags = buildImageOverlayFilter(ov, lastVideoLabel, logoLabel, outLabel).split(";");
          for (const f of frags) { if (f.trim()) filters.push(f.trim()); }
        } else {
          // No logo — pass video through unchanged
          filters.push(`${lastVideoLabel}null${outLabel}`);
        }
      }
      lastVideoLabel = outLabel;
    }

    // ── Phase 2 & 3: Post-overlay filter chain ────────────────────────────
    // Each filter consumes the previous label and emits a new one.
    // Final label is always [vout] so output maps don't need to change.
    let postLabel = "[vout]";

    if (captionPath) {
      const escapedAss = escapeFilterPath(captionPath);
      filters.push(`${postLabel}subtitles='${escapedAss}'[vcap]`);
      postLabel = "[vcap]";
    }

    if (colorGrade && (colorGrade.preset !== "clean" || colorGrade.custom)) {
      const gradeFilter = buildColorGradeFilter(colorGrade, postLabel, "[vgrade]");
      if (gradeFilter) {
        filters.push(gradeFilter);
        postLabel = "[vgrade]";
      }
    }

    // Rename final label to [vout] for consistent output mapping
    if (postLabel !== "[vout]") {
      // Re-label: replace the last filter's output label with [vout]
      const last = filters[filters.length - 1];
      filters[filters.length - 1] = last.replace(postLabel, "[vout]");
    }

    // ── Audio chain ────────────────────────────────────────────────────────
    if (narrationPath) {
      cmd = cmd.input(narrationPath);
      filters.push(`[${audioInputCount}:a]volume=${(narrationVolume / 100).toFixed(3)}[narr]`);
      audioStreams.push("[narr]");
      audioInputCount++;
    }

    if (musicPath) {
      cmd = cmd.input(musicPath);
      filters.push(`[${audioInputCount}:a]volume=${(musicVolume / 100).toFixed(3)}[mus]`);
      audioStreams.push("[mus]");
      audioInputCount++;
    }

    for (let i = 0; i < effectPaths.length; i++) {
      cmd = cmd.input(effectPaths[i]);
      filters.push(`[${audioInputCount}:a]volume=${((effectVolumes[i] ?? 80) / 100).toFixed(3)}[eff${i}]`);
      audioStreams.push(`[eff${i}]`);
      audioInputCount++;
    }

    if (audioStreams.length > 0) {
      const masterVol = (masterVolume / 100).toFixed(3);
      filters.push(`${audioStreams.join("")}amix=inputs=${audioStreams.length}:duration=first[amixed]`);

      if (hasSpeed) {
        // Apply master volume then atempo chain for audio speed
        filters.push(`[amixed]volume=${masterVol}[avol]`);
        filters.push(`[avol]${buildAtempoChain(speed)}[aout]`);
      } else {
        filters.push(`[amixed]volume=${masterVol}[aout]`);
      }

      cmd = cmd.complexFilter(filters)
        .outputOptions(["-map [vout]", "-map [aout]"]);
    } else {
      cmd = cmd.complexFilter(filters)
        .outputOptions(["-map [vout]"]);
    }

    cmd
      .outputOptions(["-c:v libx264", "-c:a aac", "-movflags +faststart", "-pix_fmt yuv420p"])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err, stdout, stderr) => {
        console.error("[demoforge] FFmpeg mix error:", err.message);
        if (stderr) console.error("[demoforge] FFmpeg stderr:", stderr);
        reject(new Error(`FFmpeg mix failed: ${err.message}\n${stderr ?? ""}`));
      })
      .run();
  });
}

// ── Step 3.5: Intro / Outro concat ───────────────────────────────────────────

async function normalizeClip(
  clipPath: string,
  dims: { width: number; height: number },
  workDir: string,
  index: number,
): Promise<string> {
  const outPath = join(workDir, `clip-norm-${index}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg(clipPath)
      .complexFilter([
        `[0:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,` +
        `pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2[vnorm]`,
      ])
      // Ensure audio track exists (silent pad if missing)
      .outputOptions([
        "-map [vnorm]",
        "-map 0:a?",
        "-c:v libx264", "-c:a aac", "-ar 44100", "-ac 2",
        "-shortest", "-pix_fmt yuv420p",
      ])
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", reject)
      .run();
  });
}

async function concatSequences(params: {
  introPaths: string[];
  mainPath: string;
  outroPaths: string[];
  dims: { width: number; height: number };
  workDir: string;
}): Promise<string> {
  const { introPaths, mainPath, outroPaths, dims, workDir } = params;

  // If there's nothing to concat, return the main path as-is
  if (introPaths.length === 0 && outroPaths.length === 0) return mainPath;

  // Normalize each clip to match main video dimensions/codecs
  const normalizedIntros = await Promise.all(
    introPaths.map((p, i) => normalizeClip(p, dims, workDir, i)),
  );
  const normalizedOutros = await Promise.all(
    outroPaths.map((p, i) => normalizeClip(p, dims, workDir, introPaths.length + 1 + i)),
  );

  const segments = [...normalizedIntros, mainPath, ...normalizedOutros];
  const outPath = join(workDir, "with-sequences.mp4");

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    const filterParts: string[] = [];
    const concatInputs: string[] = [];

    segments.forEach((seg, i) => {
      cmd = cmd.input(seg);
      filterParts.push(`[${i}:v][${i}:a]`);
      concatInputs.push(seg);
    });

    const n = segments.length;
    cmd
      .complexFilter([`${filterParts.join("")}concat=n=${n}:v=1:a=1[vout][aout]`])
      .outputOptions([
        "-map [vout]", "-map [aout]",
        "-c:v libx264", "-c:a aac", "-movflags +faststart", "-pix_fmt yuv420p",
      ])
      .output(outPath)
      .on("end", () => resolve(outPath))
      .on("error", reject)
      .run();
  });
}

// ── Step 3.5: Extract keyframes ───────────────────────────────────────────────

async function extractFrames(
  videoPath: string,
  workDir: string,
  jobId: string,
): Promise<Array<{ timestamp_sec: number; url: string; extracted_at: string }>> {
  const getDuration = () =>
    new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata.format.duration || 0);
      });
    });

  const duration = await getDuration();
  if (duration <= 0) return [];

  const timestamps = [
    1,
    Math.max(2, Math.floor(duration / 4)),
    Math.max(3, Math.floor(duration / 2)),
    Math.max(4, Math.floor((3 * duration) / 4)),
    Math.max(5, Math.floor(duration - 1)),
  ].filter((t) => t > 0 && t < duration);

  const frames: Array<{ timestamp_sec: number; url: string; extracted_at: string }> = [];
  const sb = getSupabase();

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    const framePath = join(workDir, `frame-${i}.png`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(timestamp)
        .frames(1)
        .output(framePath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    try {
      const frameData = await readFile(framePath);
      const key = `demoforge/frames/${jobId}/frame-${i}.png`;
      const { error: uploadErr } = await sb.storage.from("vantage-media").upload(key, frameData, {
        contentType: "image/png",
        upsert: true,
      });
      if (!uploadErr) {
        const { data: urlData } = sb.storage.from("vantage-media").getPublicUrl(key);
        if (urlData?.publicUrl) {
          frames.push({ timestamp_sec: timestamp, url: urlData.publicUrl, extracted_at: new Date().toISOString() });
        }
      }
    } catch (err) {
      console.warn(`Failed to upload frame ${i}:`, err);
    }
  }

  return frames;
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
  if (urlData?.publicUrl) return urlData.publicUrl;

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
  jobIn:    DemoJob,
  onStatus: (status: JobStatus) => Promise<void>,
): Promise<string> {
  let job = jobIn;
  const workDir = await mkdtemp(join(tmpdir(), "demoforge-"));

  try {
    const timeline = job.input_payload.timeline_config;
    const hasNarration = job.input_payload.script.some((s) => s.narration?.trim().length > 0);

    let narrationPath: string | null = null;
    let wordTimings: WordTiming[] = [];

    // 1. Synthesize narration FIRST — sets per-step ms to match each spoken line.
    // Missing TTS credentials degrade to a silent (but otherwise complete) video.
    if (hasNarration) {
      await onStatus("synthesizing");
      const narrationResult = await synthesizeNarration(job, workDir);
      if (narrationResult) {
        narrationPath = narrationResult.audioPath;
        wordTimings   = narrationResult.wordTimings;
        job = {
          ...job,
          input_payload: { ...job.input_payload, script: narrationResult.script },
        };
      }
    }

    // Phase 5 target duration — skip when narration sync already sized the script
    if (!narrationPath && timeline?.target_duration_sec && timeline.target_duration_sec > 0) {
      job = {
        ...job,
        input_payload: {
          ...job.input_payload,
          script: applyTargetDuration(job.input_payload.script, timeline.target_duration_sec),
        },
      };
    }

    // 2. Record browser with narration-synced step timing
    await onStatus("recording");
    const videoPath = await recordBrowser(job, workDir);

    // 3. Background music
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

    // 3.5 Sound effects
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

    // 3.75 Phase 1: Download logo files for image overlays
    const overlays = job.input_payload.overlays ?? [];
    const overlayLogoFiles: (string | null)[] = [];

    if (overlays.length > 0) {
      const sb = getSupabase();
      const kitCache = new Map<string, string | null>(); // brand_kit_id → local file path

      for (const ov of overlays) {
        if (ov.type !== "image" || !ov.brand_kit_id) continue;

        const kitId = ov.brand_kit_id;
        if (!kitCache.has(kitId)) {
          const { data: kit } = await sb.from("brand_kits")
            .select("logo_storage_path, logo_url").eq("id", kitId).single();

          let logoPath: string | null = null;
          if (kit?.logo_storage_path) {
            const { data: logoData } = await sb.storage.from("vantage-media")
              .download(kit.logo_storage_path as string);
            if (logoData) {
              logoPath = join(workDir, `logo-${kitId.slice(0, 8)}.png`);
              await writeFile(logoPath, Buffer.from(await logoData.arrayBuffer()));
            }
          }
          // Fallback: public logo_url when storage path missing
          if (!logoPath && typeof kit?.logo_url === "string" && kit.logo_url.startsWith("http")) {
            try {
              const res = await fetch(kit.logo_url);
              if (res.ok) {
                logoPath = join(workDir, `logo-${kitId.slice(0, 8)}.png`);
                await writeFile(logoPath, Buffer.from(await res.arrayBuffer()));
              }
            } catch {
              logoPath = null;
            }
          }
          kitCache.set(kitId, logoPath);
        }
      }

      // Build overlayLogoFiles: one entry per image overlay (in order)
      for (const ov of overlays) {
        if (ov.type === "image") {
          overlayLogoFiles.push(ov.brand_kit_id ? (kitCache.get(ov.brand_kit_id) ?? null) : null);
        }
      }
    }

    // 3.9 Phase 2: Generate ASS caption file from word timings
    let captionPath: string | undefined;
    const captionConfig = job.input_payload.caption_config;
    if (captionConfig?.enabled && wordTimings.length > 0) {
      captionPath = await generateCaptionASS(wordTimings, captionConfig, job.target_format, workDir);
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
      overlays,
      overlayLogoFiles,
      captionPath,
      colorGrade: job.input_payload.color_grade,
      timeline:   job.input_payload.timeline_config,
    });

    // 4.5 Phase 4: Concat intro/outro sequences around the mixed video
    let finalVideoPath = outputPath;
    const dims = FORMAT_DIMS[job.target_format] ?? FORMAT_DIMS.linkedin;
    const { intro_clip_id, outro_clip_id } = job.input_payload;

    if (intro_clip_id || outro_clip_id) {
      const sb = getSupabase();
      const introPaths: string[] = [];
      const outroPaths: string[] = [];

      if (intro_clip_id) {
        const { data: clip } = await sb.from("intro_outro_clips")
          .select("storage_path").eq("id", intro_clip_id).single();
        if (clip?.storage_path) {
          const { data: clipData } = await sb.storage.from("vantage-media")
            .download(clip.storage_path as string);
          if (clipData) {
            const introPath = join(workDir, "intro.mp4");
            await writeFile(introPath, Buffer.from(await clipData.arrayBuffer()));
            introPaths.push(introPath);
          }
        }
      }

      if (outro_clip_id) {
        const { data: clip } = await sb.from("intro_outro_clips")
          .select("storage_path").eq("id", outro_clip_id).single();
        if (clip?.storage_path) {
          const { data: clipData } = await sb.storage.from("vantage-media")
            .download(clip.storage_path as string);
          if (clipData) {
            const outroPath = join(workDir, "outro.mp4");
            await writeFile(outroPath, Buffer.from(await clipData.arrayBuffer()));
            outroPaths.push(outroPath);
          }
        }
      }

      if (introPaths.length > 0 || outroPaths.length > 0) {
        finalVideoPath = await concatSequences({
          introPaths, mainPath: outputPath, outroPaths, dims, workDir,
        });
      }
    }

    // 5. Extract keyframes
    let extractedFrames: Array<{ timestamp_sec: number; url: string; extracted_at: string }> = [];
    try {
      extractedFrames = await extractFrames(finalVideoPath, workDir, job.id);
    } catch (err) {
      console.warn("Frame extraction failed, continuing without frames:", err);
    }

    // 6. Upload video
    const publicUrl = await uploadToStorage(finalVideoPath, job.id, job.target_format);

    // 7. Persist extracted frames
    if (extractedFrames.length > 0) {
      const sb = getSupabase();
      await sb.from("demoforge_jobs")
        .update({ extracted_frames: extractedFrames })
        .eq("id", job.id);
    }

    return publicUrl;
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
