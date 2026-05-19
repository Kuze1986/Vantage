/**
 * Typed settings loader.
 * Always falls back to safe defaults so missing rows never crash the pipeline.
 */
import { getSupabaseAdmin } from "./supabase.js";

export interface PipelineSettings {
  dedup_days:            number;    // topic deduplication window in days (default 30)
  scripta_enabled:       boolean;   // include Scripta as a topic source
  bioloop_enabled:       boolean;   // run BioLoop weight updates
  active_verticals:      string[];  // empty = all verticals; non-empty = filter to these
  // 3B-6: evergreen recycling
  evergreen_threshold:   number;    // min engagement events to qualify for recycling (default 3)
  evergreen_recycle_days: number;   // days before a recycled topic can be used again (default 90)
}

const DEFAULTS: PipelineSettings = {
  dedup_days:            30,
  scripta_enabled:       true,
  bioloop_enabled:       true,
  active_verticals:      [],
  evergreen_threshold:   3,
  evergreen_recycle_days: 90,
};

export async function loadSettings(): Promise<PipelineSettings> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("settings").select("key, value");
    if (!data?.length) return { ...DEFAULTS };

    const map: Record<string, unknown> = {};
    for (const row of data) map[row.key as string] = row.value;

    return {
      dedup_days:             typeof map.dedup_days             === "number"  ? map.dedup_days             : DEFAULTS.dedup_days,
      scripta_enabled:        typeof map.scripta_enabled         === "boolean" ? map.scripta_enabled         : DEFAULTS.scripta_enabled,
      bioloop_enabled:        typeof map.bioloop_enabled         === "boolean" ? map.bioloop_enabled         : DEFAULTS.bioloop_enabled,
      active_verticals:       Array.isArray(map.active_verticals)              ? map.active_verticals as string[] : DEFAULTS.active_verticals,
      evergreen_threshold:    typeof map.evergreen_threshold    === "number"  ? map.evergreen_threshold    : DEFAULTS.evergreen_threshold,
      evergreen_recycle_days: typeof map.evergreen_recycle_days === "number"  ? map.evergreen_recycle_days : DEFAULTS.evergreen_recycle_days,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function patchSettings(patch: Partial<PipelineSettings>): Promise<void> {
  const sb = getSupabaseAdmin();
  const rows = Object.entries(patch).map(([key, value]) => ({
    key,
    value: value as unknown,
    updated_at: new Date().toISOString(),
  }));
  for (const row of rows) {
    await sb.from("settings").upsert(row, { onConflict: "key" });
  }
}
