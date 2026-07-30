/**
 * Per-product brand voice loader + seed helpers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase.js";
import {
  brandVoiceSeedRow,
  resolveBrandPack,
  type BrandPack,
} from "./brand-packs.js";
import { PRODUCT_SLUGS, parseProductSlug, type ProductSlug } from "./products.js";

export interface BrandVoiceRow {
  id: string;
  workspace_id: string;
  product_slug: ProductSlug;
  name: string;
  description: string | null;
  per_channel_tone: Record<string, unknown>;
  off_topics: string[];
  pack: unknown;
}

export function brandVoiceToPromptString(voice: BrandVoiceRow): string {
  const pack = resolveBrandPack(voice.product_slug, voice.pack);
  return JSON.stringify({
    name: voice.name,
    description: voice.description,
    product: voice.product_slug,
    essence: pack.essence,
    voice_register: pack.voice.register,
    voice_do: pack.voice.do,
    voice_dont: pack.voice.dont,
    per_channel_tone: voice.per_channel_tone,
    off_topics: voice.off_topics,
  });
}

/** Idempotently ensure all six product voices exist for a workspace. */
export async function seedBrandVoicesForWorkspace(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const rows = PRODUCT_SLUGS.map((slug) => brandVoiceSeedRow(workspaceId, slug));
  await sb.from("brand_voice").upsert(rows, {
    onConflict: "workspace_id,product_slug",
    ignoreDuplicates: true,
  });
}

/**
 * Load brand voice for a product. Seeds defaults if missing.
 * Falls back to workspace `vantage` voice, then any voice row.
 */
export async function loadBrandVoice(
  workspaceId: string,
  productSlug: ProductSlug | string,
): Promise<BrandVoiceRow> {
  const slug = parseProductSlug(productSlug);
  const sb = getSupabaseAdmin();
  await seedBrandVoicesForWorkspace(sb, workspaceId);

  const { data: exact } = await sb
    .from("brand_voice")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("product_slug", slug)
    .maybeSingle();

  if (exact) return normalizeRow(exact);

  if (slug !== "vantage") {
    const { data: vantage } = await sb
      .from("brand_voice")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("product_slug", "vantage")
      .maybeSingle();
    if (vantage) return normalizeRow(vantage);
  }

  const { data: anyVoice } = await sb
    .from("brand_voice")
    .select("*")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  if (!anyVoice) {
    throw new Error("Configure brand voice first");
  }
  return normalizeRow(anyVoice);
}

export function packFromVoice(voice: BrandVoiceRow): BrandPack {
  return resolveBrandPack(voice.product_slug, voice.pack);
}

function normalizeRow(row: Record<string, unknown>): BrandVoiceRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    product_slug: parseProductSlug(row.product_slug),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    per_channel_tone: (row.per_channel_tone as Record<string, unknown>) ?? {},
    off_topics: Array.isArray(row.off_topics) ? (row.off_topics as string[]) : [],
    pack: row.pack ?? {},
  };
}
