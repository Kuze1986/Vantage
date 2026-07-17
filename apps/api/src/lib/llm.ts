/**
 * Task-aware LLM provider resolution.
 *
 * Each AI task (content generation via Kuze, compliance audit via Ilita) can run
 * on a different provider. Resolution order, highest priority first:
 *   1. Per-workspace setting  (llm_provider_generate / llm_provider_audit)
 *   2. Per-task env default    (LLM_PROVIDER_GENERATE / LLM_PROVIDER_AUDIT)
 *   3. Global env default      (LLM_PROVIDER)
 *   4. Registry fallback       (first available: anthropic → openai → grok)
 *
 * getPreferredLLMProvider() already falls back to the first *available* provider
 * if the preferred one has no API key configured, so a bad/missing choice never
 * hard-fails as long as one provider is configured.
 */
import { getPreferredLLMProvider, type LLMProvider } from "./llm-providers/index.js";
import { loadSettings } from "./settings.js";

export const PROVIDER_NAMES = ["anthropic", "openai", "grok"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type LLMTask = "generate" | "audit";

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === "string" && (PROVIDER_NAMES as readonly string[]).includes(v);
}

export async function resolveProvider(task: LLMTask, workspaceId?: string): Promise<LLMProvider> {
  let preferred: string | undefined;

  // 1. Per-workspace override (empty string means "inherit the env default").
  if (workspaceId) {
    try {
      const s = await loadSettings(workspaceId);
      const chosen = task === "generate" ? s.llm_provider_generate : s.llm_provider_audit;
      if (chosen) preferred = chosen;
    } catch {
      // Settings unavailable — fall through to env.
    }
  }

  // 2/3. Env defaults.
  if (!preferred) {
    const envTask = task === "generate" ? process.env.LLM_PROVIDER_GENERATE : process.env.LLM_PROVIDER_AUDIT;
    preferred = envTask || process.env.LLM_PROVIDER || undefined;
  }

  return getPreferredLLMProvider(preferred);
}
