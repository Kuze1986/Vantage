import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  // Typed with an explicit parameter so mock.calls[n][0] is well-typed under tsc.
  logActivity: vi.fn(async (_input: Record<string, any>) => {}),
  providers: new Map<string, any>(),
}));

vi.mock('./activity.js', () => ({ logActivity: h.logActivity }));

vi.mock('./llm-providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm-providers/index.js')>();
  return {
    ...actual,
    getLLMProvider: (name: string) => {
      const p = h.providers.get(name);
      if (!p) throw new Error(`test provider not registered: ${name}`);
      return p;
    },
    isLLMProviderAvailable: (name: string) => h.providers.has(name),
  };
});

const { __testing } = await import('./llm.js');
const { LLMChainExhaustedError } = await import('./llm-pool.js');
const { LLMProviderValidationError } = await import('./llm-providers/types.js');
const { runChain } = __testing;

const SLOTS = [
  { provider: 'openai' as const, model: 'gpt-4o' },
  { provider: 'anthropic' as const, model: 'claude-sonnet-5' },
  { provider: 'gemini' as const, model: 'gemini-2.0-flash' },
];
const CTX = { task: 'generate' as const, workspaceId: 'ws-1', label: 'kuze.test' };

/** The classifier reads only the error, so `fn` can ignore the provider entirely. */
const stubProvider = { name: 'stub' } as any;

beforeEach(() => {
  h.logActivity.mockClear();
  h.logActivity.mockImplementation(async (_input: Record<string, any>) => {});
  h.providers.clear();
  h.providers.set('openai', stubProvider);
  h.providers.set('anthropic', stubProvider);
  h.providers.set('gemini', stubProvider);
});

function rateLimit() {
  return Object.assign(new Error('rate limit exceeded'), { status: 429 });
}
function outOfCredits() {
  return Object.assign(
    new Error('Your credit balance is too low to access the Anthropic API'),
    { status: 400 },
  );
}

describe('runChain', () => {
  it('calls the head slot once and logs nothing on success', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(runChain(CTX, SLOTS, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.logActivity).not.toHaveBeenCalled();
  });

  it('passes each slot model down to the call', async () => {
    const seen: string[] = [];
    const fn = vi.fn(async (_p: any, model: string) => {
      seen.push(model);
      if (seen.length === 1) throw rateLimit();
      return 'ok';
    });
    await runChain(CTX, SLOTS, fn);
    expect(seen).toEqual(['gpt-4o', 'claude-sonnet-5']);
  });

  it('fails over on a rate limit and logs exactly one llm.failover', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n === 1) throw rateLimit();
      return 'recovered';
    });

    await expect(runChain(CTX, SLOTS, fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);

    const events = h.logActivity.mock.calls.map((c) => (c[0] as any).event_type);
    expect(events).toEqual(['llm.slot_failed', 'llm.failover']);

    const failover = h.logActivity.mock.calls.find(
      (c) => (c[0] as any).event_type === 'llm.failover',
    )![0] as any;
    expect(failover.payload.to).toBe('anthropic:claude-sonnet-5');
    expect(failover.payload.attempts[0].slot).toBe('openai:gpt-4o');
    expect(failover.workspace_id).toBe('ws-1');
  });

  it('fails over when a provider is out of credits (HTTP 400)', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n === 1) throw outOfCredits();
      return 'recovered';
    });
    await expect(runChain(CTX, SLOTS, fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows a fatal error by identity without trying another slot', async () => {
    const fatal = new LLMProviderValidationError('openai', 'schema mismatch');
    const fn = vi.fn(async () => {
      throw fatal;
    });

    await expect(runChain(CTX, SLOTS, fn)).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws LLMChainExhaustedError naming every slot when all fail', async () => {
    const fn = vi.fn(async () => {
      throw rateLimit();
    });

    await expect(runChain(CTX, SLOTS, fn)).rejects.toBeInstanceOf(LLMChainExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);

    const err = await runChain(CTX, SLOTS, fn).catch((e) => e);
    expect(err.message).toContain('openai:gpt-4o');
    expect(err.message).toContain('anthropic:claude-sonnet-5');
    expect(err.message).toContain('gemini:gemini-2.0-flash');
    expect(
      h.logActivity.mock.calls.some((c) => (c[0] as any).event_type === 'llm.chain_exhausted'),
    ).toBe(true);
  });

  it('still returns a successful result when activity logging rejects', async () => {
    // logActivity throws on insert failure — that must never fail the generation.
    h.logActivity.mockImplementation(async (_input: Record<string, any>) => {
      throw new Error('activity_events insert failed');
    });
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n === 1) throw rateLimit();
      return 'ok';
    });
    await expect(runChain(CTX, SLOTS, fn)).resolves.toBe('ok');
  });

  it('respects a single-slot chain (failover disabled)', async () => {
    const fn = vi.fn(async () => {
      throw rateLimit();
    });
    await expect(runChain(CTX, SLOTS.slice(0, 1), fn)).rejects.toBeInstanceOf(
      LLMChainExhaustedError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
