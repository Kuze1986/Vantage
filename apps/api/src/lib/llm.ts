/**
 * Task-aware LLM provider + model resolution, with automatic failover.
 *
 * Each AI task (content generation via Kuze, compliance audit via Ilita) resolves to
 * an ordered chain of {provider, model} slots. Calls walk the chain: a provider-side
 * failure (rate limit, out of credits, overload, network) advances to the next slot;
 * a request-shaped failure (bad schema, bad params) aborts immediately.
 *
 * Resolution order, highest priority first:
 *   1. Per-workspace setting  (llm_provider_generate / llm_provider_audit)
 *   2. Per-task pool env      (LLM_POOL_GENERATE / LLM_POOL_AUDIT)
 *   3. Per-task env default   (LLM_PROVIDER_GENERATE / LLM_PROVIDER_AUDIT)
 *   4. Global pool env        (LLM_POOL)
 *   5. Global env default     (LLM_PROVIDER)
 *   6. Task default           (generate → openai, audit → anthropic)
 *
 * Settings values accept both the legacy bare provider name ("anthropic") and the
 * pool form ("openai:gpt-4o,anthropic"), so existing rows keep working untouched.
 */
import {
  getLLMProvider,
  isLLMProviderAvailable,
  type LLMProvider,
  type GenerationOptions,
  type StructuredSchema,
} from "./llm-providers/index.js";
import { providerDefaultModel, type ProviderName } from "./llm-providers/models.js";
import {
  buildChain,
  classifyLLMError,
  formatSlot,
  LLMChainExhaustedError,
  type LLMSlot,
  type LLMTask,
  type SlotAttempt,
} from "./llm-pool.js";
import { loadSettings } from "./settings.js";
import { logActivity } from "./activity.js";

export { PROVIDER_NAMES, isProviderName, type ProviderName } from "./llm-providers/models.js";
export { LLMChainExhaustedError, type LLMSlot, type LLMTask } from "./llm-pool.js";

/**
 * A resolved task LLM. Structurally an `LLMProvider` — so every existing caller and
 * test double keeps working — but each generate* call walks the failover chain.
 */
export interface TaskLLM extends LLMProvider {
  /** The resolved chain, head first. Exposed for diagnostics / the settings UI. */
  readonly slots: readonly LLMSlot[];
}

interface ChainContext {
  task: LLMTask;
  workspaceId?: string;
  label?: string;
}

/** Activity logging must never convert a successful generation into a failure. */
function safeLog(input: Parameters<typeof logActivity>[0]): void {
  void logActivity(input).catch(() => {
    /* activity_events insert failed — not worth failing the request over */
  });
}

function errMessage(err: unknown): string {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return raw.slice(0, 300);
}

/** Resolve the ordered slot chain for a task without building a provider wrapper. */
export async function resolveChain(task: LLMTask, workspaceId?: string): Promise<LLMSlot[]> {
  let workspaceProvider: string | undefined;
  let workspaceModel: string | undefined;
  let failoverEnabled = true;

  if (workspaceId) {
    try {
      const s = await loadSettings(workspaceId);
      workspaceProvider = task === "generate" ? s.llm_provider_generate : s.llm_provider_audit;
      workspaceModel = task === "generate" ? s.llm_model_generate : s.llm_model_audit;
      failoverEnabled = s.llm_failover_enabled;
    } catch {
      // Settings unavailable — fall through to env, as before.
    }
  }

  return buildChain({
    task,
    workspaceProvider,
    workspaceModel,
    env: process.env,
    isAvailable: (p) => isLLMProviderAvailable(p),
    defaultModelFor: (p) => providerDefaultModel(p),
    failoverEnabled,
  });
}

/**
 * Walk the chain until one slot succeeds.
 *
 * - `fatal` rethrows the ORIGINAL error object (callers string-match their own
 *   messages downstream; wrapping would break them).
 * - `transient` / `auth` record the attempt and advance.
 * - Every slot failing throws LLMChainExhaustedError naming each attempt.
 */
async function runChain<T>(
  ctx: ChainContext,
  slots: readonly LLMSlot[],
  fn: (provider: LLMProvider, model: string) => Promise<T>,
): Promise<T> {
  const attempts: SlotAttempt[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    try {
      const result = await fn(getLLMProvider(slot.provider), slot.model);
      if (i > 0) {
        safeLog({
          source: "llm",
          source_type: "system",
          event_type: "llm.failover",
          summary: `${ctx.task} recovered on ${formatSlot(slot)} after ${i} failed slot(s)`,
          payload: {
            task: ctx.task,
            label: ctx.label,
            to: formatSlot(slot),
            attempts: attempts.map((a) => ({
              slot: formatSlot(a.slot),
              classification: a.classification,
              error: a.message,
            })),
          },
          workspace_id: ctx.workspaceId,
        });
      }
      return result;
    } catch (err) {
      const classification = classifyLLMError(err);
      safeLog({
        source: "llm",
        source_type: "system",
        event_type: "llm.slot_failed",
        summary: `${ctx.task} slot ${formatSlot(slot)} failed (${classification})`,
        payload: {
          task: ctx.task,
          label: ctx.label,
          slot: formatSlot(slot),
          attempt: i + 1,
          classification,
          error: errMessage(err),
        },
        workspace_id: ctx.workspaceId,
      });

      // Request-shaped failure: another provider will fail the same way.
      if (classification === "fatal") throw err;

      attempts.push({ slot, classification, message: errMessage(err) });
    }
  }

  const exhausted = new LLMChainExhaustedError(ctx.task, attempts);
  safeLog({
    source: "llm",
    source_type: "system",
    event_type: "llm.chain_exhausted",
    summary: exhausted.message.slice(0, 500),
    payload: {
      task: ctx.task,
      label: ctx.label,
      attempts: attempts.map((a) => ({
        slot: formatSlot(a.slot),
        classification: a.classification,
        error: a.message,
      })),
    },
    workspace_id: ctx.workspaceId,
  });
  throw exhausted;
}

/**
 * Resolve the LLM for a task.
 *
 * Signature and name are unchanged from the single-provider version: callers and the
 * existing `vi.mock("../lib/llm.js")` test doubles need no edits. `label` is optional
 * and only enriches failover logs.
 */
export async function resolveProvider(
  task: LLMTask,
  workspaceId?: string,
  label?: string,
): Promise<TaskLLM> {
  const slots = await resolveChain(task, workspaceId);
  if (!slots.length) {
    // Same message as the previous implementation — nothing downstream regresses.
    throw new Error("No LLM provider configured");
  }

  const ctx: ChainContext = { task, workspaceId, label };
  const head = slots[0]!;
  const headProvider = getLLMProvider(head.provider);

  return {
    name: headProvider.name,
    displayName: headProvider.displayName,
    available: true,
    defaultModel: head.model,
    candidateModels: headProvider.candidateModels,
    slots,

    generateCompletion(prompt: string, options?: GenerationOptions): Promise<string> {
      return runChain(ctx, slots, (provider, model) =>
        provider.generateCompletion(prompt, { ...options, model }),
      );
    },

    generateStructured<T>(
      prompt: string,
      schema: StructuredSchema<T>,
      options?: GenerationOptions,
    ): Promise<T> {
      return runChain(ctx, slots, (provider, model) =>
        provider.generateStructured<T>(prompt, schema, { ...options, model }),
      );
    },

    getCost() {
      return headProvider.getCost();
    },

    validateConfig() {
      return headProvider.validateConfig();
    },
  };
}

/** Exported for tests — the executor without the provider-wrapper scaffolding. */
export const __testing = { runChain };
