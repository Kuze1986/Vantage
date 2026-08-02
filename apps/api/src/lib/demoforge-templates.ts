/**
 * DemoForge template registry.
 * Seeded with Shift portfolio templates as defaults; other template JSON files
 * can be added under ./demoforge-templates/ and will appear in the registry.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveTemplatesDir(): string {
  const besideModule = join(dirname(fileURLToPath(import.meta.url)), "demoforge-templates");
  if (existsSync(besideModule)) return besideModule;
  // Source tree when running compiled dist/ without copied JSON
  const fromCwd = join(process.cwd(), "src", "lib", "demoforge-templates");
  if (existsSync(fromCwd)) return fromCwd;
  // Portfolio seeds (repo root relative to apps/api)
  const portfolio = join(process.cwd(), "..", "..", "scripts", "portfolio", "templates");
  if (existsSync(portfolio)) return portfolio;
  return besideModule;
}

const TEMPLATES_DIR = resolveTemplatesDir();

export type DemoForgeFormat = "tiktok" | "linkedin" | "instagram";

export interface DemoForgeTemplateStep {
  action: string;
  selector?: string;
  text?: string;
  ms?: number;
  narration?: string;
}

export interface DemoForgeTemplate {
  id: string;
  name?: string;
  format: DemoForgeFormat;
  defaultBaseUrl?: string;
  steps: DemoForgeTemplateStep[];
}

export interface DemoForgeScriptStep {
  action: string;
  selector?: string;
  text?: string;
  ms?: number;
  narration: string;
}

export interface DemoForgeJobPayload {
  target_format: DemoForgeFormat;
  url: string;
  script: DemoForgeScriptStep[];
  caption_config?: { enabled: boolean };
  color_grade?: { preset: string };
  /** Passed through to DemoForge mix — used to drop blank/white lead-in frames. */
  timeline_config?: {
    trim_start_sec?: number;
    trim_end_sec?: number;
    target_duration_sec?: number;
    global_speed_multiplier?: number;
  };
}

/** Channel → default template id (Shift seeds) for demo_video. */
export const DEFAULT_TEMPLATE_BY_CHANNEL: Record<string, string> = {
  x: "shift-queue-modes",
  linkedin: "shift-ube-university-demo",
  reddit: "shift-queue-modes",
  threads: "shift-queue-modes",
  bluesky: "shift-queue-modes",
  tiktok: "shift-queue-reel",
  instagram: "shift-queue-reel",
  facebook: "shift-queue-modes",
};

/** Visual type → default template when the idea/campaign omit one. */
export const DEFAULT_TEMPLATE_BY_VISUAL_TYPE: Record<string, string> = {
  product_still: "shift-product-stills",
};

/** Preferred keyframe index for write-back (`last` = Sweep hero on product stills). */
export const DEFAULT_THUMBNAIL_FRAME_BY_VISUAL_TYPE: Record<string, number | "last"> = {
  product_still: "last",
};

export const DEFAULT_BRAND_ID = "shift";

/** Modes captured by shift-product-stills (rotation order; Sweep is the hero close). */
export const PRODUCT_STILL_MODE_ROTATION = [
  "queue",
  "mcu",
  "streak",
  "blueprints",
  "callback",
  "matrix",
  "minefield",
  "polarity",
  "drop",
  "sweep",
] as const;

let cache: DemoForgeTemplate[] | null = null;

function parseTemplate(raw: unknown, fallbackId: string): DemoForgeTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : fallbackId;
  const format = o.format;
  if (format !== "tiktok" && format !== "linkedin" && format !== "instagram") return null;
  if (!Array.isArray(o.steps)) return null;
  return {
    id,
    name: typeof o.name === "string" ? o.name : id,
    format,
    defaultBaseUrl: typeof o.defaultBaseUrl === "string" ? o.defaultBaseUrl : undefined,
    steps: o.steps as DemoForgeTemplateStep[],
  };
}

/** List all registered templates (from JSON files on disk). */
export function listDemoForgeTemplates(): DemoForgeTemplate[] {
  if (cache) return cache;
  if (!existsSync(TEMPLATES_DIR)) {
    cache = [];
    return cache;
  }
  const out: DemoForgeTemplate[] = [];
  for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, file), "utf8"));
      const tpl = parseTemplate(raw, file.replace(/\.json$/, ""));
      if (tpl) out.push(tpl);
    } catch {
      /* skip bad files */
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  cache = out;
  return out;
}

export function getDemoForgeTemplate(templateId: string): DemoForgeTemplate | null {
  return listDemoForgeTemplates().find((t) => t.id === templateId) ?? null;
}

/** Resolve template id: idea → campaign default → visual-type default → channel Shift default. */
export function resolveTemplateId(opts: {
  ideaTemplateId?: string | null;
  campaignDefaultTemplateId?: string | null;
  channel?: string | null;
  visualType?: string | null;
}): string {
  if (opts.ideaTemplateId && getDemoForgeTemplate(opts.ideaTemplateId)) {
    return opts.ideaTemplateId;
  }
  // product_still ignores campaign video defaults unless the idea named a template —
  // stills should use the mode-capture reel, not a narrated demo.
  const visual = (opts.visualType ?? "").toLowerCase();
  if (visual === "product_still") {
    const stillDefault = DEFAULT_TEMPLATE_BY_VISUAL_TYPE.product_still;
    if (stillDefault && getDemoForgeTemplate(stillDefault)) return stillDefault;
  }
  if (opts.campaignDefaultTemplateId && getDemoForgeTemplate(opts.campaignDefaultTemplateId)) {
    return opts.campaignDefaultTemplateId;
  }
  if (visual && DEFAULT_TEMPLATE_BY_VISUAL_TYPE[visual] && getDemoForgeTemplate(DEFAULT_TEMPLATE_BY_VISUAL_TYPE[visual]!)) {
    return DEFAULT_TEMPLATE_BY_VISUAL_TYPE[visual]!;
  }
  const channel = (opts.channel ?? "x").toLowerCase();
  return DEFAULT_TEMPLATE_BY_CHANNEL[channel] ?? "shift-queue-modes";
}

/** Resolve which extracted frame becomes the piece image_url / job thumbnail. */
export function resolveThumbnailFrameIndex(
  visualType: string | null | undefined,
  explicit?: number | null,
  frameCount = 0,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    if (frameCount > 0) return Math.min(Math.floor(explicit), frameCount - 1);
    return Math.floor(explicit);
  }
  const pref = DEFAULT_THUMBNAIL_FRAME_BY_VISUAL_TYPE[(visualType ?? "").toLowerCase()];
  if (pref === "last" && frameCount > 0) return frameCount - 1;
  if (typeof pref === "number" && frameCount > 0) return Math.min(pref, frameCount - 1);
  return 0;
}

export function resolveBrandId(opts: {
  ideaBrandId?: string | null;
  campaignDefaultBrandId?: string | null;
}): string {
  return (opts.ideaBrandId?.trim() || opts.campaignDefaultBrandId?.trim() || DEFAULT_BRAND_ID);
}

export function defaultBaseUrlForTemplate(tpl: DemoForgeTemplate): string {
  return (
    process.env.SHIFT_BASE_URL?.trim() ||
    tpl.defaultBaseUrl ||
    "https://theshift.bioloopnexus.com"
  ).replace(/\/$/, "");
}

/**
 * Build a DemoForge job payload from a registry template id.
 * Includes optional Shift auth-bypass eval when template id starts with "shift-".
 */
export function buildDemoForgePayload(
  templateId: string,
  baseUrl?: string,
  opts?: {
    captions?: boolean;
    colorPreset?: "cinematic" | "clean" | "warm" | "vibrant" | "muted" | "cool" | "dark";
    authBypass?: boolean;
  },
): DemoForgeJobPayload {
  const tpl = getDemoForgeTemplate(templateId);
  if (!tpl) throw new Error(`Unknown DemoForge template: ${templateId}`);

  const base = (baseUrl ?? defaultBaseUrlForTemplate(tpl)).replace(/\/$/, "");
  const script: DemoForgeScriptStep[] = [];

  const useAuthBypass = opts?.authBypass !== false && templateId.startsWith("shift-");
  if (useAuthBypass) {
    script.push({
      action: "eval",
      selector: "sessionStorage.setItem('the_shift_auth_bypass_mode','admin');",
      narration: "",
    });
  }

  for (const step of tpl.steps) {
    script.push({
      action: step.action,
      selector: step.selector ? step.selector.replace(/\{BASE\}/g, base) : undefined,
      text: step.text,
      ms: step.ms,
      narration: step.narration ?? "",
    });
  }

  // Prefer first navigate URL as start URL; fall back to /Queue for Shift-style apps.
  const firstNav = script.find((s) => s.action === "navigate" && s.selector);
  const startUrl = firstNav?.selector ?? `${base}/Queue`;

  return {
    target_format: tpl.format,
    url: startUrl,
    script,
    ...(opts?.captions !== false ? { caption_config: { enabled: true } } : {}),
    ...(opts?.colorPreset ? { color_grade: { preset: opts.colorPreset } } : {}),
    // Drop the short lead-in (about:blank → first paint) so Queue previews don't open on white.
    timeline_config: { trim_start_sec: 0.75 },
  };
}
