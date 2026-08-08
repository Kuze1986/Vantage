/**
 * Provider specs — the single source of truth for provider names, API-key env
 * aliases, base URLs, and model defaults.
 *
 * Deliberately pure: no SDK imports, no I/O. That keeps it importable from both the
 * registry (which pulls in the SDKs) and the pure pool module (which must stay
 * unit-testable without network or Supabase).
 *
 * Env aliases and model defaults follow the same conventions as the shared
 * `@bioloop/llm` router in the sibling repo, so the two stay interchangeable even
 * though Vantage deliberately keeps its own self-contained copy (Railway builds this
 * monorepo alone, so a `file:../bioloop-llm` dependency could never resolve).
 */

export const PROVIDER_NAMES = ['anthropic', 'openai', 'gemini', 'grok', 'kimi'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface ProviderSpec {
  displayName: string;
  /** API key env vars — first non-empty wins. */
  apiKeyEnvs: readonly string[];
  /** Model override env vars — first non-empty wins. */
  modelEnvs: readonly string[];
  /** Base URL override env vars — first non-empty wins. */
  baseUrlEnvs: readonly string[];
  /** Base URL when no env override is set. Undefined = use the SDK's own default. */
  defaultBaseUrl?: string;
  /** Model used when no env override and no explicit slot model. */
  defaultModel: string;
  /** Cheaper/faster sibling — surfaced as a candidate, not yet auto-selected. */
  cheapModel: string;
  /** Suggestions for the Settings model input. Not a whitelist — any id is accepted. */
  candidates: readonly string[];
}

export const PROVIDER_SPECS: Record<ProviderName, ProviderSpec> = {
  anthropic: {
    displayName: 'Claude (Anthropic)',
    apiKeyEnvs: ['ANTHROPIC_API_KEY'],
    modelEnvs: ['ANTHROPIC_MODEL'],
    baseUrlEnvs: ['ANTHROPIC_BASE_URL'],
    defaultModel: 'claude-sonnet-5',
    // Haiku 4.5 is the current cheap tier — there is no Haiku 5.
    cheapModel: 'claude-haiku-4-5-20251001',
    candidates: [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-haiku-4-5-20251001',
    ],
  },
  openai: {
    displayName: 'GPT (OpenAI)',
    apiKeyEnvs: ['OPENAI_API_KEY'],
    modelEnvs: ['OPENAI_MODEL'],
    baseUrlEnvs: ['OPENAI_BASE_URL'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    cheapModel: 'gpt-4o-mini',
    candidates: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  },
  gemini: {
    displayName: 'Gemini (Google)',
    apiKeyEnvs: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    modelEnvs: ['GEMINI_MODEL'],
    baseUrlEnvs: ['GEMINI_BASE_URL'],
    // Google's OpenAI-compatibility layer — lets Gemini ride the existing `openai`
    // SDK instead of adding @google/genai as a dependency.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    cheapModel: 'gemini-2.0-flash',
    candidates: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'],
  },
  grok: {
    // Registry key stays `grok` (not `xai`): PROVIDER_NAMES and persisted
    // settings.llm_provider_* rows already use it. Env aliases follow XAI_*.
    displayName: 'Grok (xAI)',
    apiKeyEnvs: ['XAI_API_KEY', 'GROK_API_KEY'],
    modelEnvs: ['XAI_MODEL', 'GROK_MODEL'],
    baseUrlEnvs: ['XAI_BASE_URL'],
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.5',
    cheapModel: 'grok-4.5',
    candidates: ['grok-4.5', 'grok-2-vision-1212'],
  },
  kimi: {
    displayName: 'Kimi (Moonshot)',
    apiKeyEnvs: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    modelEnvs: ['KIMI_MODEL', 'MOONSHOT_MODEL'],
    baseUrlEnvs: ['KIMI_BASE_URL', 'MOONSHOT_BASE_URL'],
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k3',
    cheapModel: 'kimi-k2',
    candidates: ['kimi-k3', 'kimi-k2'],
  },
};

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && (PROVIDER_NAMES as readonly string[]).includes(v);
}

/** First non-empty value among `keys`, trimmed. */
function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function providerApiKey(name: ProviderName): string | undefined {
  return firstEnv(PROVIDER_SPECS[name].apiKeyEnvs);
}

export function providerConfigured(name: ProviderName): boolean {
  return !!providerApiKey(name);
}

/** Base URL for the provider, or undefined to let the SDK use its own default. */
export function providerBaseUrl(name: ProviderName): string | undefined {
  const spec = PROVIDER_SPECS[name];
  return firstEnv(spec.baseUrlEnvs) ?? spec.defaultBaseUrl;
}

/**
 * The provider's model when no explicit per-slot model is given:
 * env override → spec default. Read at call time, not module-import time, so a
 * changed env (and `vi.stubEnv` in tests) takes effect.
 */
export function providerDefaultModel(name: ProviderName): string {
  const spec = PROVIDER_SPECS[name];
  return firstEnv(spec.modelEnvs) ?? spec.defaultModel;
}
