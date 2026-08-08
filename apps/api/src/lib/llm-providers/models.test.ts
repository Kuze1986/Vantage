import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  PROVIDER_NAMES,
  PROVIDER_SPECS,
  isProviderName,
  providerApiKey,
  providerBaseUrl,
  providerConfigured,
  providerDefaultModel,
} from './models.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider spec table', () => {
  it('has a spec for every name and no extras', () => {
    expect(Object.keys(PROVIDER_SPECS).sort()).toEqual([...PROVIDER_NAMES].sort());
  });

  it('lists its own default and cheap models as candidates', () => {
    for (const name of PROVIDER_NAMES) {
      const spec = PROVIDER_SPECS[name];
      expect(spec.candidates, `${name} default`).toContain(spec.defaultModel);
      expect(spec.candidates, `${name} cheap`).toContain(spec.cheapModel);
    }
  });

  it('declares at least one API key env for every provider', () => {
    for (const name of PROVIDER_NAMES) {
      expect(PROVIDER_SPECS[name].apiKeyEnvs.length).toBeGreaterThan(0);
    }
  });
});

describe('isProviderName', () => {
  it('accepts every registered name', () => {
    for (const name of PROVIDER_NAMES) expect(isProviderName(name)).toBe(true);
  });

  it('rejects the legacy workspaces.llm_provider values and junk', () => {
    // vantage.workspaces.llm_provider has CHECK IN ('claude','gpt4o','grok') — two of
    // those three match no registry name and must not resolve.
    for (const v of ['claude', 'gpt4o', '', null, undefined, 42, 'xai']) {
      expect(isProviderName(v)).toBe(false);
    }
  });
});

describe('env resolution', () => {
  it('prefers the first listed key env', () => {
    vi.stubEnv('GEMINI_API_KEY', 'first');
    vi.stubEnv('GOOGLE_API_KEY', 'second');
    expect(providerApiKey('gemini')).toBe('first');
  });

  it('falls back to the alias when the primary is unset', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', 'from-alias');
    expect(providerApiKey('gemini')).toBe('from-alias');
    expect(providerConfigured('gemini')).toBe(true);
  });

  it('treats whitespace-only keys as unset', () => {
    vi.stubEnv('KIMI_API_KEY', '   ');
    vi.stubEnv('MOONSHOT_API_KEY', '');
    expect(providerConfigured('kimi')).toBe(false);
  });

  it('lets *_MODEL override the spec default, read at call time', () => {
    expect(providerDefaultModel('openai')).toBe('gpt-4o');
    vi.stubEnv('OPENAI_MODEL', 'gpt-4.1');
    expect(providerDefaultModel('openai')).toBe('gpt-4.1');
  });

  it('prefers XAI_MODEL over GROK_MODEL and KIMI_MODEL over MOONSHOT_MODEL', () => {
    vi.stubEnv('XAI_MODEL', 'from-xai');
    vi.stubEnv('GROK_MODEL', 'from-grok');
    expect(providerDefaultModel('grok')).toBe('from-xai');

    vi.stubEnv('KIMI_MODEL', 'from-kimi');
    vi.stubEnv('MOONSHOT_MODEL', 'from-moonshot');
    expect(providerDefaultModel('kimi')).toBe('from-kimi');
  });

  it('returns the compat base URL for gemini and honours an override', () => {
    expect(providerBaseUrl('gemini')).toContain('generativelanguage.googleapis.com');
    vi.stubEnv('GEMINI_BASE_URL', 'https://proxy.example/v1');
    expect(providerBaseUrl('gemini')).toBe('https://proxy.example/v1');
  });

  it('leaves anthropic without a base URL so the SDK default applies', () => {
    // Stubbed rather than asserted bare: ANTHROPIC_BASE_URL is commonly set in a
    // developer shell, and this asserts the spec has no baked-in default.
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    expect(providerBaseUrl('anthropic')).toBeUndefined();
  });

  it('honours ANTHROPIC_BASE_URL when set', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://proxy.example');
    expect(providerBaseUrl('anthropic')).toBe('https://proxy.example');
  });
});
