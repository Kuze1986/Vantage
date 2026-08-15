/**
 * LLM slot pool — provider/model chain resolution and failure classification.
 *
 * Deliberately pure: imports only the provider spec table and error types. No SDK,
 * no Supabase, no settings loader — so the whole precedence and classification
 * surface is unit-testable without network or env scaffolding.
 */

import { isProviderName, type ProviderName } from './llm-providers/models.js';
import {
  LLMProviderNotFoundError,
  LLMProviderUnavailableError,
  LLMProviderValidationError,
} from './llm-providers/types.js';

/** One attempt: a provider paired with the model to ask it for. */
export interface LLMSlot {
  provider: ProviderName;
  model: string;
}

/** A slot before model resolution — model may be absent, meaning "provider default". */
export interface PartialSlot {
  provider: ProviderName;
  model?: string;
}

export type LLMTask = 'generate' | 'audit';

/** Default head provider per task. Kuze writes on OpenAI, Ilita grades on Anthropic. */
export const TASK_DEFAULT_PROVIDER: Record<LLMTask, ProviderName> = {
  generate: 'openai',
  audit: 'anthropic',
};

/** Failover tail order per task — the head's own provider is deduped out later. */
export const TASK_FALLBACK_ORDER: Record<LLMTask, readonly ProviderName[]> = {
  generate: ['openai', 'anthropic', 'gemini', 'grok', 'kimi'],
  audit: ['anthropic', 'openai', 'gemini', 'grok', 'kimi'],
};

/** Slots attempted before giving up. Bounded so a dead provider can't 5x latency. */
export const DEFAULT_MAX_ATTEMPTS = 3;

// ── Slot parsing ──────────────────────────────────────────────────────────────

/**
 * Parse one `provider` or `provider:model` entry.
 * Returns null for anything unrecognised — a stale settings row must never throw
 * and brick the pipeline; it just drops out of the chain.
 */
export function parseSlot(raw: string): PartialSlot | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Split on the FIRST colon only — model ids can contain colons.
  const idx = trimmed.indexOf(':');
  const providerPart = (idx === -1 ? trimmed : trimmed.slice(0, idx)).trim().toLowerCase();
  const modelPart = idx === -1 ? '' : trimmed.slice(idx + 1).trim();

  if (!isProviderName(providerPart)) return null;
  return modelPart ? { provider: providerPart, model: modelPart } : { provider: providerPart };
}

/** Parse a comma-separated pool string, dropping unparseable entries and duplicates. */
export function parsePool(raw: string | null | undefined): PartialSlot[] {
  if (!raw) return [];
  const out: PartialSlot[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const slot = parseSlot(entry);
    if (!slot) continue;
    const key = `${slot.provider}:${slot.model ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

export function formatSlot(slot: LLMSlot): string {
  return `${slot.provider}:${slot.model}`;
}

/** How many comma-separated entries a pool string contains (for validation). */
export function countPoolEntries(raw: string): number {
  return raw.split(',').filter((s) => s.trim().length > 0).length;
}

// ── Chain building ────────────────────────────────────────────────────────────

export interface BuildChainInput {
  task: LLMTask;
  /** settings.llm_provider_<task> — accepts a bare name or a pool string. */
  workspaceProvider?: string;
  /** settings.llm_model_<task> — applies to the head slot only. */
  workspaceModel?: string;
  /** Injected for testability; production passes process.env. */
  env: Record<string, string | undefined>;
  isAvailable: (provider: ProviderName) => boolean;
  defaultModelFor: (provider: ProviderName) => string;
  maxAttempts?: number;
  /** When false the chain is truncated to a single slot (failover disabled). */
  failoverEnabled?: boolean;
}

/**
 * Resolve the ordered slot chain for a task.
 *
 * Precedence — the FIRST source yielding at least one parseable slot wins outright.
 * Sources are not merged: a predictable chain matters more than a clever one.
 *
 *   1. workspace setting  llm_provider_<task>     (bare name or pool)
 *   2. env  LLM_POOL_<TASK>
 *   3. env  LLM_PROVIDER_<TASK>
 *   4. env  LLM_POOL
 *   5. env  LLM_PROVIDER
 *   6. task default (generate → openai, audit → anthropic)
 *
 * Then: workspace model applied to the head only → remaining models filled from
 * provider defaults → failover tail appended → unavailable providers filtered out →
 * deduped → truncated to maxAttempts.
 */
export function buildChain(input: BuildChainInput): LLMSlot[] {
  const {
    task,
    workspaceProvider,
    workspaceModel,
    env,
    isAvailable,
    defaultModelFor,
    failoverEnabled = true,
  } = input;

  const TASK_UPPER = task.toUpperCase();
  const sources: (string | undefined)[] = [
    workspaceProvider,
    env[`LLM_POOL_${TASK_UPPER}`],
    env[`LLM_PROVIDER_${TASK_UPPER}`],
    env.LLM_POOL,
    env.LLM_PROVIDER,
  ];

  let explicit: PartialSlot[] = [];
  for (const source of sources) {
    const parsed = parsePool(source);
    if (parsed.length) {
      explicit = parsed;
      break;
    }
  }
  if (!explicit.length) {
    explicit = [{ provider: TASK_DEFAULT_PROVIDER[task] }];
  }

  // The workspace model box sits next to one provider box, so it belongs to the head
  // slot only. Applying it down the chain would push e.g. a GPT model id onto Claude.
  const head = explicit[0]!;
  const chosenModel = workspaceModel?.trim();
  if (chosenModel && !head.model) {
    explicit[0] = { ...head, model: chosenModel };
  }

  const withTail: PartialSlot[] = failoverEnabled
    ? [...explicit, ...TASK_FALLBACK_ORDER[task].map((provider) => ({ provider }))]
    : explicit;

  const out: LLMSlot[] = [];
  const seen = new Set<string>();
  for (const slot of withTail) {
    if (!isAvailable(slot.provider)) continue;
    const resolved: LLMSlot = {
      provider: slot.provider,
      model: slot.model ?? defaultModelFor(slot.provider),
    };
    const key = formatSlot(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }

  const envCap = Number(env.LLM_MAX_ATTEMPTS);
  const cap = input.maxAttempts
    ?? (Number.isInteger(envCap) && envCap > 0 ? envCap : DEFAULT_MAX_ATTEMPTS);
  return failoverEnabled ? out.slice(0, cap) : out.slice(0, 1);
}

// ── Error classification ──────────────────────────────────────────────────────

export type ErrorClass = 'transient' | 'auth' | 'fatal';

/**
 * Provider-side failures worth retrying on a DIFFERENT provider.
 *
 * Much wider than a status-code check, because the case this feature exists for —
 * Anthropic out of credits — arrives as HTTP **400** with the message
 * "Your credit balance is too low to access the Anthropic API". A status-first
 * classifier calls that fatal and never fails over.
 */
const TRANSIENT_RE =
  /\b(429|402|408|500|502|503|504|529)\b|overloaded|rate.?limit|resource.?exhausted|too many requests|insufficient[_ -]?(credits?|quota|funds|balance)|credit balance|billing|payment required|quota exceeded|out of credits|capacity|server[_ ]?error|service unavailable|temporarily unavailable|upstream (connect )?error|bad gateway|econnreset|etimedout|enotfound|eai_again|econnrefused|socket hang up|fetch failed|network error|timed? ?out/i;

/**
 * A model id the provider rejects. Treated as transient because the NEXT slot has a
 * different model — failing over is exactly the right response to a bad model id.
 */
const MODEL_MISCONFIG_RE =
  /model.{0,20}(not found|does not exist|not supported|is not available)|unknown model|invalid model|does not exist or you do not have access/i;

const AUTH_RE =
  /\b(401|403)\b|invalid[_ -]?api[_ -]?key|incorrect api key|unauthorized|authentication|permission denied|api key not valid/i;

/**
 * Unknown errors fail over rather than abort: one wasted call is cheaper than a
 * silently dropped content slot. Errors we can PROVE are input-shaped (schema
 * validation, a 4xx with no transient marker) are already fatal above.
 */
const UNKNOWN_ERROR_CLASS: ErrorClass = 'transient';

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  const candidates = [
    e.status,
    e.statusCode,
    (e.response as Record<string, unknown> | undefined)?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

export function classifyLLMError(err: unknown): ErrorClass {
  // 1. Our own validation failures are about the RESPONSE SHAPE, not the provider.
  //    Another provider won't fix a schema mismatch.
  if (err instanceof LLMProviderValidationError) return 'fatal';
  if (err instanceof LLMProviderNotFoundError) return 'fatal';
  // 2. Key vanished between resolution and call — try the next slot.
  if (err instanceof LLMProviderUnavailableError) return 'transient';

  const msg = String(
    (err && typeof err === 'object' && 'message' in err
      ? (err as { message: unknown }).message
      : err) ?? '',
  );

  // 3-4. MESSAGE BEFORE STATUS — this ordering is the whole point (see TRANSIENT_RE).
  if (MODEL_MISCONFIG_RE.test(msg)) return 'transient';
  if (TRANSIENT_RE.test(msg)) return 'transient';

  const status = errorStatus(err);
  if (status === 401 || status === 403) return 'auth';
  if (AUTH_RE.test(msg)) return 'auth';

  if (status !== null) {
    // A provider 404 commonly means a retired model or compatibility route. It
    // cannot be repaired by retrying the same slot, but a configured fallback
    // can still complete the task. Other request-shaped 4xx responses remain
    // blocking below.
    if (status === 404) return 'transient';
    if (status === 429 || status === 402 || status === 408 || status >= 500) return 'transient';
    if (status >= 400) return 'fatal';
  }

  return UNKNOWN_ERROR_CLASS;
}

// ── Chain exhaustion ──────────────────────────────────────────────────────────

export interface SlotAttempt {
  slot: LLMSlot;
  classification: ErrorClass;
  message: string;
}

/**
 * Every slot failed. The message names each attempt and why it failed — this string
 * lands verbatim in the scheduler's `auto_generate_error` activity row, which today
 * records an opaque failure.
 */
export class LLMChainExhaustedError extends Error {
  readonly task: LLMTask;
  readonly attempts: SlotAttempt[];

  constructor(task: LLMTask, attempts: SlotAttempt[]) {
    const detail = attempts.length
      ? attempts.map((a) => `${formatSlot(a.slot)} (${a.classification}: ${a.message})`).join(', ')
      : 'no slots available';
    super(`LLM chain exhausted for task "${task}": ${detail}`);
    this.name = 'LLMChainExhaustedError';
    this.task = task;
    this.attempts = attempts;
  }
}
