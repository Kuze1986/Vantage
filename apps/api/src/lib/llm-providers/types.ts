/**
 * LLM Provider Abstraction
 * Supports pluggable AI model providers (Anthropic, OpenAI, Grok, etc.)
 */

import { z } from 'zod';

/**
 * Generation options for LLM completion
 */
export interface GenerationOptions {
  temperature?: number;         // 0-2, default 1
  max_tokens?: number;          // max output tokens
  top_p?: number;               // 0-1, nucleus sampling
  stop_sequences?: string[];    // sequences to stop at
  system_prompt?: string;       // system context
}

/**
 * Structured output schema
 */
export interface StructuredSchema<T> {
  description: string;
  schema: z.ZodSchema<T>;
}

/**
 * Base LLM Provider interface
 * All providers must implement these methods
 */
export interface LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly available: boolean;  // false if API key not configured

  /**
   * Generate a simple text completion
   */
  generateCompletion(
    prompt: string,
    options?: GenerationOptions
  ): Promise<string>;

  /**
   * Generate structured output (JSON schema validation)
   */
  generateStructured<T>(
    prompt: string,
    schema: StructuredSchema<T>,
    options?: GenerationOptions
  ): Promise<T>;

  /**
   * Cost estimation per 1000 tokens
   */
  getCost(): {
    input_per_1k: number;
    output_per_1k: number;
  };

  /**
   * Provider-specific configuration/validation
   */
  validateConfig(): Promise<boolean>;
}

/**
 * Provider registry for all available LLM providers
 */
export interface LLMProviderRegistry {
  get(name: string): LLMProvider | undefined;
  list(): LLMProvider[];
  listAvailable(): LLMProvider[];
}

/**
 * LLM Provider factory errors
 */
export class LLMProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public code?: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMProviderError';
  }
}

export class LLMProviderNotFoundError extends LLMProviderError {
  constructor(provider: string) {
    super(provider, `Provider not found`, 'NOT_FOUND');
  }
}

export class LLMProviderUnavailableError extends LLMProviderError {
  constructor(provider: string) {
    super(provider, `Provider not available (API key not configured)`, 'UNAVAILABLE');
  }
}

export class LLMProviderValidationError extends LLMProviderError {
  constructor(provider: string, message: string) {
    super(provider, `Validation failed: ${message}`, 'VALIDATION_FAILED');
  }
}
