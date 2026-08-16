/**
 * Resolve the product fact sheet that governs a generation or audit.
 *
 * Why this is resolved centrally rather than passed by each caller: the fact
 * sheet gate originally lived only in the campaign launch route, which built an
 * "approved facts" string and prepended it to `topic_text`. Every other path
 * into the content pipeline — the autopilot cadence in services/scheduler.ts,
 * its regenerate-with-feedback retry, the manual generate/caption routes — called
 * `generateContent` with a bare topic and no facts at all. In the 2026-08-15
 * launch that meant ~600 of ~670 generated pieces were written with no product
 * ground truth, against topics recycled from a different product's curriculum.
 *
 * Resolving inside `generateContent` / `auditContent` instead of at each call
 * site means a new caller cannot reintroduce that gap by forgetting to pass it.
 *
 * Precedence: an explicit campaign fact sheet wins (a campaign is a deliberate,
 * human-confirmed statement of what this push may claim); otherwise the
 * workspace-level default in `settings.product_fact_sheet` applies. When neither
 * exists the agents are told so explicitly — Kuze writes without product claims
 * and Ilita fails anything asserting a capability it cannot verify.
 */

import { isProductFactSheet, type ProductFactSheet } from "@vantage/prompts";
import { getSupabaseAdmin } from "./supabase.js";

export const WORKSPACE_FACT_SHEET_KEY = "product_fact_sheet";

/** Fact sheets change rarely and are read on every generation; a short TTL keeps the hot path off the DB. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: ProductFactSheet | null; expires: number }>();

/** Test seam — the scheduler runs for minutes at a time and must not serve a stale sheet after an edit. */
export function clearFactSheetCache(): void {
  cache.clear();
}

async function loadCampaignFactSheet(campaignId: string): Promise<ProductFactSheet | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("campaigns").select("fact_sheet").eq("id", campaignId).maybeSingle();
  const fact = data?.fact_sheet;
  return isProductFactSheet(fact) ? fact : null;
}

async function loadWorkspaceFactSheet(workspaceId: string): Promise<ProductFactSheet | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("key", WORKSPACE_FACT_SHEET_KEY)
    .maybeSingle();
  const raw = data?.value;
  // settings.value is jsonb but has historically held JSON-encoded strings too.
  const parsed = typeof raw === "string" ? safeParse(raw) : raw;
  return isProductFactSheet(parsed) ? parsed : null;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Never throws: a fact sheet lookup failing must degrade to "no facts" (which the
 * prompts handle explicitly) rather than take down a campaign launch.
 */
export async function resolveFactSheet(
  workspaceId: string | undefined,
  campaignId?: string | null,
): Promise<ProductFactSheet | null> {
  if (!workspaceId) return null;
  const cacheKey = `${workspaceId}:${campaignId ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: ProductFactSheet | null = null;
  try {
    if (campaignId) value = await loadCampaignFactSheet(campaignId);
    if (!value) value = await loadWorkspaceFactSheet(workspaceId);
  } catch {
    value = null;
  }

  cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}
