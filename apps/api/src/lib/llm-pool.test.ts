import { describe, it, expect } from 'vitest';
import {
  parseSlot,
  parsePool,
  formatSlot,
  buildChain,
  classifyLLMError,
  LLMChainExhaustedError,
  type BuildChainInput,
  type LLMSlot,
} from './llm-pool.js';
import { PROVIDER_NAMES, type ProviderName } from './llm-providers/models.js';
import {
  LLMProviderNotFoundError,
  LLMProviderUnavailableError,
  LLMProviderValidationError,
} from './llm-providers/types.js';

// ── parseSlot / parsePool ─────────────────────────────────────────────────────

describe('parseSlot', () => {
  it('parses a bare provider with no model', () => {
    expect(parseSlot('openai')).toEqual({ provider: 'openai' });
  });

  it('parses provider:model', () => {
    expect(parseSlot('openai:gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('splits on the first colon only — model ids may contain colons', () => {
    expect(parseSlot('openai:gpt-4o:preview')).toEqual({
      provider: 'openai',
      model: 'gpt-4o:preview',
    });
  });

  it('trims and lowercases the provider but preserves model case', () => {
    expect(parseSlot('  OpenAI : GPT-4o ')).toEqual({ provider: 'openai', model: 'GPT-4o' });
  });

  it('treats a trailing colon as no model', () => {
    expect(parseSlot('openai:')).toEqual({ provider: 'openai' });
  });

  it('returns null for empty or unknown providers instead of throwing', () => {
    expect(parseSlot('')).toBeNull();
    expect(parseSlot('   ')).toBeNull();
    expect(parseSlot('bogus')).toBeNull();
    expect(parseSlot('claude')).toBeNull(); // legacy workspaces.llm_provider value
  });
});

describe('parsePool', () => {
  it('drops unparseable entries without throwing', () => {
    expect(parsePool('openai,bogus,anthropic')).toEqual([
      { provider: 'openai' },
      { provider: 'anthropic' },
    ]);
  });

  it('ignores empty entries', () => {
    expect(parsePool('openai,,anthropic,')).toHaveLength(2);
  });

  it('dedupes identical slots', () => {
    expect(parsePool('openai:gpt-4o,openai:gpt-4o')).toHaveLength(1);
  });

  it('returns empty for null/undefined/empty input', () => {
    expect(parsePool(null)).toEqual([]);
    expect(parsePool(undefined)).toEqual([]);
    expect(parsePool('')).toEqual([]);
  });
});

// ── buildChain ────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  grok: 'grok-4.5',
  kimi: 'kimi-k3',
};

function chain(over: Partial<BuildChainInput> = {}): LLMSlot[] {
  return buildChain({
    task: 'generate',
    env: {},
    isAvailable: () => true,
    defaultModelFor: (p) => DEFAULT_MODELS[p],
    ...over,
  });
}

describe('buildChain precedence', () => {
  it('workspace setting beats task env beats global env', () => {
    const out = chain({
      workspaceProvider: 'grok',
      env: { LLM_PROVIDER_GENERATE: 'openai', LLM_PROVIDER: 'anthropic' },
    });
    expect(out[0]!.provider).toBe('grok');
  });

  it('empty workspace setting falls through to env — today\'s "inherit" semantics', () => {
    const out = chain({
      workspaceProvider: '',
      env: { LLM_PROVIDER_GENERATE: 'kimi' },
    });
    expect(out[0]!.provider).toBe('kimi');
  });

  it('LLM_POOL_<TASK> beats LLM_PROVIDER_<TASK>', () => {
    const out = chain({ env: { LLM_POOL_GENERATE: 'gemini', LLM_PROVIDER_GENERATE: 'openai' } });
    expect(out[0]!.provider).toBe('gemini');
  });

  it('task-scoped env beats global env', () => {
    const out = chain({ env: { LLM_POOL: 'kimi', LLM_PROVIDER_GENERATE: 'grok' } });
    expect(out[0]!.provider).toBe('grok');
  });

  it('LLM_POOL beats LLM_PROVIDER', () => {
    const out = chain({ env: { LLM_POOL: 'kimi', LLM_PROVIDER: 'grok' } });
    expect(out[0]!.provider).toBe('kimi');
  });

  it('defaults generate to openai and audit to anthropic', () => {
    expect(chain({ task: 'generate' })[0]).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(chain({ task: 'audit' })[0]).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    });
  });

  it('ignores an unparseable workspace value and falls through', () => {
    const out = chain({ workspaceProvider: 'claude', env: { LLM_PROVIDER: 'kimi' } });
    expect(out[0]!.provider).toBe('kimi');
  });
});

describe('buildChain model resolution', () => {
  it('applies the workspace model to the head slot only', () => {
    const out = chain({ workspaceProvider: 'openai,anthropic', workspaceModel: 'gpt-4o-mini' });
    expect(out[0]).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(out[1]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('lets an explicit slot model win over the workspace model box', () => {
    const out = chain({ workspaceProvider: 'openai:gpt-4.1', workspaceModel: 'gpt-4o-mini' });
    expect(out[0]!.model).toBe('gpt-4.1');
  });

  it('fills unspecified models from provider defaults', () => {
    const out = chain({ workspaceProvider: 'openai:gpt-4o,anthropic' });
    expect(out[1]!.model).toBe('claude-sonnet-5');
  });
});

describe('buildChain availability and tail', () => {
  it('drops unavailable providers and promotes the next one', () => {
    const out = chain({
      workspaceProvider: 'openai',
      isAvailable: (p) => p === 'anthropic',
    });
    expect(out.map((s) => s.provider)).toEqual(['anthropic']);
  });

  it('yields anthropic-only for generate when only anthropic has a key', () => {
    const out = chain({ task: 'generate', isAvailable: (p) => p === 'anthropic' });
    expect(out).toEqual([{ provider: 'anthropic', model: 'claude-sonnet-5' }]);
  });

  it('returns an empty chain when nothing is configured', () => {
    expect(chain({ isAvailable: () => false })).toEqual([]);
  });

  it('appends a failover tail after an explicit single slot', () => {
    const out = chain({ workspaceProvider: 'kimi', maxAttempts: 10 });
    expect(out[0]!.provider).toBe('kimi');
    expect(out.length).toBeGreaterThan(1);
  });

  it('never repeats a provider:model pair', () => {
    const out = chain({ workspaceProvider: 'openai', maxAttempts: 10 });
    const keys = out.map(formatSlot);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('truncates to maxAttempts', () => {
    expect(chain({ maxAttempts: 2 })).toHaveLength(2);
  });

  it('honours LLM_MAX_ATTEMPTS from env', () => {
    expect(chain({ env: { LLM_MAX_ATTEMPTS: '1' } })).toHaveLength(1);
  });

  it('collapses to a single slot when failover is disabled', () => {
    const out = chain({ failoverEnabled: false, maxAttempts: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.provider).toBe('openai');
  });
});

// ── classifyLLMError ──────────────────────────────────────────────────────────

describe('classifyLLMError', () => {
  it('treats an out-of-credits 400 from Anthropic as transient', () => {
    // The case this whole feature exists for. Anthropic sends HTTP 400, so a
    // status-first classifier would call this fatal and never fail over.
    const err = Object.assign(
      new Error('Your credit balance is too low to access the Anthropic API'),
      { status: 400 },
    );
    expect(classifyLLMError(err)).toBe('transient');
  });

  it("treats OpenAI's insufficient_quota as transient", () => {
    const err = Object.assign(new Error('You exceeded your current quota'), {
      status: 429,
      code: 'insufficient_quota',
    });
    expect(classifyLLMError(err)).toBe('transient');
  });

  it.each([
    ['rate limit', { status: 429, message: 'rate_limit_error' }],
    ['overloaded', { status: 529, message: 'Overloaded' }],
    ['payment required', { status: 402, message: 'Payment required' }],
    ['service unavailable', { status: 503, message: 'Service Unavailable' }],
    ['request timeout', { status: 408, message: 'Request timeout' }],
  ])('classifies %s as transient', (_label, shape) => {
    expect(classifyLLMError(Object.assign(new Error(shape.message), shape))).toBe('transient');
  });

  it('classifies a rejected model id as transient so the next slot is tried', () => {
    const err = Object.assign(new Error('The model `gpt-5-ultra` does not exist'), {
      status: 404,
    });
    expect(classifyLLMError(err)).toBe('transient');
  });

  it('fails over from a provider 404 with no response body', () => {
    const err = Object.assign(new Error('404 status code (no body)'), { status: 404 });
    expect(classifyLLMError(err)).toBe('transient');
  });

  it('classifies bad credentials as auth', () => {
    const err = Object.assign(new Error('Incorrect API key provided'), { status: 401 });
    expect(classifyLLMError(err)).toBe('auth');
  });

  it('classifies our own schema validation failure as fatal', () => {
    expect(classifyLLMError(new LLMProviderValidationError('openai', 'schema mismatch'))).toBe(
      'fatal',
    );
  });

  it('classifies an unknown provider as fatal', () => {
    expect(classifyLLMError(new LLMProviderNotFoundError('nope'))).toBe('fatal');
  });

  it('classifies a vanished key as transient', () => {
    expect(classifyLLMError(new LLMProviderUnavailableError('openai'))).toBe('transient');
  });

  it('classifies a genuine bad-request as fatal', () => {
    const err = Object.assign(new Error('Invalid value for max_tokens'), { status: 400 });
    expect(classifyLLMError(err)).toBe('fatal');
  });

  it('classifies an unprocessable entity as fatal', () => {
    expect(classifyLLMError(Object.assign(new Error('Unprocessable'), { status: 422 }))).toBe(
      'fatal',
    );
  });

  it.each([
    ['network failure', new Error('fetch failed')],
    ['socket timeout', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ['unknown', new Error('???')],
  ])('defaults %s to transient', (_label, err) => {
    expect(classifyLLMError(err)).toBe('transient');
  });

  it('reads a status nested under response', () => {
    expect(classifyLLMError({ response: { status: 503 }, message: 'boom' })).toBe('transient');
  });
});

// ── LLMChainExhaustedError ────────────────────────────────────────────────────

describe('LLMChainExhaustedError', () => {
  it('names every attempted slot and why it failed', () => {
    const err = new LLMChainExhaustedError('generate', [
      {
        slot: { provider: 'openai', model: 'gpt-4o' },
        classification: 'transient',
        message: '429 rate limit',
      },
      {
        slot: { provider: 'anthropic', model: 'claude-sonnet-5' },
        classification: 'transient',
        message: 'credit balance too low',
      },
    ]);
    expect(err.message).toContain('openai:gpt-4o');
    expect(err.message).toContain('anthropic:claude-sonnet-5');
    expect(err.message).toContain('credit balance too low');
    expect(err.attempts).toHaveLength(2);
  });

  it('reads sensibly with no attempts', () => {
    expect(new LLMChainExhaustedError('audit', []).message).toContain('no slots available');
  });
});

// ── spec table sanity ─────────────────────────────────────────────────────────

describe('provider specs', () => {
  it('covers every provider name in the task fallback orders', async () => {
    const { TASK_FALLBACK_ORDER } = await import('./llm-pool.js');
    for (const task of ['generate', 'audit'] as const) {
      expect([...TASK_FALLBACK_ORDER[task]].sort()).toEqual([...PROVIDER_NAMES].sort());
    }
  });
});
