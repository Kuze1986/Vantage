/**
 * LLM Provider Factory & Registry
 * Centralizes LLM provider management and selection
 */

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GrokProvider } from './grok.js';
import type {
  LLMProvider,
  LLMProviderRegistry,
} from './types.js';
import {
  LLMProviderNotFoundError,
  LLMProviderUnavailableError,
} from './types.js';

export * from './types.js';

/**
 * Default registry instance
 */
const registry = new Map<string, LLMProvider>();

// Initialize registry with all providers
registry.set('anthropic', new AnthropicProvider());
registry.set('openai', new OpenAIProvider());
registry.set('grok', new GrokProvider());

/**
 * Get a specific LLM provider by name
 */
export function getLLMProvider(name: string): LLMProvider {
  const provider = registry.get(name);
  if (!provider) {
    throw new LLMProviderNotFoundError(name);
  }
  if (!provider.available) {
    throw new LLMProviderUnavailableError(name);
  }
  return provider;
}

/**
 * Get preferred LLM provider (from settings or fallback)
 */
export function getPreferredLLMProvider(preferredName?: string): LLMProvider {
  if (preferredName) {
    try {
      return getLLMProvider(preferredName);
    } catch {
      // Fall through to default
    }
  }

  // Default: Anthropic (already integrated), then OpenAI, then Grok
  const defaults = ['anthropic', 'openai', 'grok'];
  for (const name of defaults) {
    const provider = registry.get(name);
    if (provider?.available) {
      return provider;
    }
  }

  throw new Error('No LLM provider configured');
}

/**
 * List all registered providers
 */
export function listLLMProviders(): LLMProvider[] {
  return Array.from(registry.values());
}

/**
 * List only available providers (API key configured)
 */
export function listAvailableLLMProviders(): LLMProvider[] {
  return Array.from(registry.values()).filter((p) => p.available);
}

/**
 * Check if a provider is available
 */
export function isLLMProviderAvailable(name: string): boolean {
  const provider = registry.get(name);
  return !!provider?.available;
}

/**
 * Validate provider configuration
 */
export async function validateLLMProvider(name: string): Promise<boolean> {
  const provider = registry.get(name);
  if (!provider) {
    return false;
  }
  return provider.validateConfig();
}

/**
 * Get cost estimates for all available providers
 */
export function getLLMProviderCosts(): Record<string, { input_per_1k: number; output_per_1k: number }> {
  const costs: Record<string, any> = {};
  for (const provider of registry.values()) {
    if (provider.available) {
      costs[provider.name] = provider.getCost();
    }
  }
  return costs;
}
