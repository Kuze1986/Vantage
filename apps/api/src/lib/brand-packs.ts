/**
 * Default Social Kit brand packs for portfolio marketing.
 * Seeded into brand_voice.pack and returned by the marketing API when DB pack is empty.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PRODUCT_SLUGS, type ProductSlug, isProductSlug } from "./products.js";

export interface BrandPack {
  id: ProductSlug;
  name: string;
  essence: string;
  handle: string;
  domain: string;
  accent: string;
  accent2: string;
  statusLabel: string;
  statusTone: string;
  accentName: string;
  eyebrowMeta: string;
  palette: Array<{ name: string; hex: string; dark: boolean }>;
  voice: { register: string; do: string[]; dont: string[] };
  captions: Array<{ tag: string; tone: string; title: string; body: string }>;
  hashtags: Record<string, string>;
  launch: Record<string, unknown>;
  insight: Record<string, unknown>;
}

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, "brand-packs-data", "packs.json"),
  join(here, "..", "lib", "brand-packs-data", "packs.json"), // dist → src sibling fallback
];

function loadPacks(): Record<ProductSlug, BrandPack> {
  let raw = "";
  for (const p of candidates) {
    try {
      raw = readFileSync(p, "utf8");
      break;
    } catch {
      /* try next */
    }
  }
  if (!raw) throw new Error("brand-packs-data/packs.json not found");
  const parsed = JSON.parse(raw) as Record<string, BrandPack>;
  const out = {} as Record<ProductSlug, BrandPack>;
  for (const slug of PRODUCT_SLUGS) {
    if (!parsed[slug]) throw new Error(`Missing brand pack for ${slug}`);
    out[slug] = parsed[slug]!;
  }
  return out;
}

export const DEFAULT_BRAND_PACKS: Record<ProductSlug, BrandPack> = loadPacks();

export function getDefaultBrandPack(slug: ProductSlug): BrandPack {
  return DEFAULT_BRAND_PACKS[slug];
}

/** Merge stored pack jsonb with Social Kit defaults. */
export function resolveBrandPack(slug: ProductSlug, stored: unknown): BrandPack {
  const base = getDefaultBrandPack(slug);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const s = stored as Partial<BrandPack>;
  return {
    ...base,
    ...s,
    id: slug,
    voice: { ...base.voice, ...(s.voice ?? {}) },
    captions: Array.isArray(s.captions) && s.captions.length ? s.captions : base.captions,
    hashtags: { ...base.hashtags, ...(s.hashtags ?? {}) },
    palette: Array.isArray(s.palette) && s.palette.length ? s.palette : base.palette,
    launch: { ...base.launch, ...(s.launch ?? {}) },
    insight: { ...base.insight, ...(s.insight ?? {}) },
  };
}

export function brandVoiceSeedRow(workspaceId: string, slug: ProductSlug) {
  const pack = getDefaultBrandPack(slug);
  return {
    workspace_id: workspaceId,
    product_slug: slug,
    name: pack.name,
    description: `${pack.essence}\n\nVoice: ${pack.voice.register}`,
    per_channel_tone: {},
    off_topics: [],
    pack,
  };
}

export function assertProductSlug(value: string): ProductSlug {
  if (!isProductSlug(value)) {
    throw new Error(`Invalid product_slug: ${value}`);
  }
  return value;
}
