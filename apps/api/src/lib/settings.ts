/**
 * Typed settings loader.
 * Always falls back to safe defaults so missing rows never crash the pipeline.
 */
import { getSupabaseAdmin } from "./supabase.js";

export interface PipelineSettings {
  dedup_days:       number;    // topic deduplication window in days (default 30)
  scripta_enabled:  boolean;   // include Scripta as a topic source
  bioloop_enabled:  boolean;   // run BioLoop weight updates
  active_verticals: string[];  // empty = all verticals; non-empty = filter to these
}

const DEFAULTS: PipelineSettings = {
  dedup_days:       30,
  scripta_enabled:  true,
  bioloop_enabled:  true,
  active_verticals: [],
};

export async function loadSettings(): Promise<PipelineSettings> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("settings").select("key, value");
    if (!data?.length) return { ...DEFAULTS };

    const map: Record<string, unknown> = {};
    for (const row of data) map[row.key as string] = row.value;

    return {
      dedup_days:       typeof map.dedup_days      === "number"  ? map.dedup_days      : DEFAULTS.dedup_days,
      scripta_enabled:  typeof map.scripta_enabled  === "boolean" ? map.scripta_enabled  : DEFAULTS.scripta_enabled,
      bioloop_enabled:  typeof map.bioloop_enabled  === "boolean" ? map.bioloop_enabled  : DEFAULTS.bioloop_enabled,
      active_verticals: Array.isArray(map.active_verticals)       ? map.active_verticals as string[] : DEFAULTS.active_verticals,
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
