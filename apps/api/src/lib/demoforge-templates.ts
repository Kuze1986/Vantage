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
}

/** Channel → default template id (Shift seeds). */
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

export const DEFAULT_BRAND_ID = "shift";

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

/** Resolve template id: idea → campaign default → channel Shift default. */
export function resolveTemplateId(opts: {
  ideaTemplateId?: string | null;
  campaignDefaultTemplateId?: string | null;
  channel?: string | null;
}): string {
  if (opts.ideaTemplateId && getDemoForgeTemplate(opts.ideaTemplateId)) {
    return opts.ideaTemplateId;
  }
  if (opts.campaignDefaultTemplateId && getDemoForgeTemplate(opts.campaignDefaultTemplateId)) {
    return opts.campaignDefaultTemplateId;
  }
  const channel = (opts.channel ?? "x").toLowerCase();
  return DEFAULT_TEMPLATE_BY_CHANNEL[channel] ?? "shift-queue-modes";
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
  };
}
