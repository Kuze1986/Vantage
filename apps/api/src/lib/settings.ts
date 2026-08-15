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
  // Multi-LLM: per-task provider override. "" = inherit env default (LLM_PROVIDER_*).
  // Accepts a bare provider name ("anthropic") or a failover pool
  // ("openai:gpt-4o,anthropic"), so pre-existing rows keep working unchanged.
  llm_provider_generate: string;    // content generation (Kuze)
  llm_provider_audit:    string;    // compliance audit (Ilita)
  // Per-task model override, applied to the head slot. "" = provider default.
  llm_model_generate:    string;
  llm_model_audit:       string;
  // When false, a task uses only its head slot — no failover to other providers.
  llm_failover_enabled:  boolean;
  // Workspace-authored guidance layered onto the respective prompt. These may
  // refine terminology, audience, and format preferences but not disable the
  // baseline compliance rules.
  generator_instructions: string;
  auditor_instructions:   string;
  // 3C-6: branded newsletter chrome. Serialized HTML from the Email Builder,
  // containing the {{content}} marker where the generated body is spliced in.
  // "" = send Kuze's raw HTML, the pre-wrapper behaviour. Stored here rather
  // than on email_templates because settings.value is JSONB and needs no
  // migration — see lib/email-wrapper.ts for why the serializer can't be shared.
  email_wrapper_html:    string;
}

const DEFAULTS: PipelineSettings = {
  dedup_days:            30,
  scripta_enabled:       true,
  bioloop_enabled:       true,
  active_verticals:      [],
  evergreen_threshold:   3,
  evergreen_recycle_days: 90,
  llm_provider_generate: "",
  llm_provider_audit:    "",
  llm_model_generate:    "",
  llm_model_audit:       "",
  llm_failover_enabled:  true,
  generator_instructions: "",
  auditor_instructions:   "",
  email_wrapper_html:    "",
};

export async function loadSettings(workspaceId: string): Promise<PipelineSettings> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("settings").select("key, value").eq("workspace_id", workspaceId);
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
      llm_provider_generate:  typeof map.llm_provider_generate  === "string"  ? map.llm_provider_generate  : DEFAULTS.llm_provider_generate,
      llm_provider_audit:     typeof map.llm_provider_audit     === "string"  ? map.llm_provider_audit     : DEFAULTS.llm_provider_audit,
      llm_model_generate:     typeof map.llm_model_generate     === "string"  ? map.llm_model_generate     : DEFAULTS.llm_model_generate,
      llm_model_audit:        typeof map.llm_model_audit        === "string"  ? map.llm_model_audit        : DEFAULTS.llm_model_audit,
      llm_failover_enabled:   typeof map.llm_failover_enabled   === "boolean" ? map.llm_failover_enabled   : DEFAULTS.llm_failover_enabled,
      generator_instructions: typeof map.generator_instructions === "string"  ? map.generator_instructions : DEFAULTS.generator_instructions,
      auditor_instructions:   typeof map.auditor_instructions   === "string"  ? map.auditor_instructions   : DEFAULTS.auditor_instructions,
      email_wrapper_html:     typeof map.email_wrapper_html     === "string"  ? map.email_wrapper_html     : DEFAULTS.email_wrapper_html,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function patchSettings(workspaceId: string, patch: Partial<PipelineSettings>): Promise<void> {
  const sb = getSupabaseAdmin();
  const rows = Object.entries(patch).map(([key, value]) => ({
    workspace_id: workspaceId,
    key,
    value: value as unknown,
    updated_at: new Date().toISOString(),
  }));
  for (const row of rows) {
    await sb.from("settings").upsert(row, { onConflict: "workspace_id,key" });
  }
}
