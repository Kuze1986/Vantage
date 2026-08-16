/**
 * Anthropic Claude Provider
 * Uses ANTHROPIC_API_KEY environment variable
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  LLMProvider,
  GenerationOptions,
  StructuredSchema,
} from './types.js';
import {
  LLMProviderUnavailableError,
  LLMProviderValidationError,
} from './types.js';
import {
  PROVIDER_SPECS,
  providerApiKey,
  providerBaseUrl,
  providerConfigured,
  providerDefaultModel,
} from './models.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly displayName = PROVIDER_SPECS.anthropic.displayName;

  private client: Anthropic | null = null;

  get available(): boolean {
    return providerConfigured('anthropic');
  }

  /** Getter, not a field: a field initializer would freeze the env read at import time. */
  get defaultModel(): string {
    return providerDefaultModel('anthropic');
  }

  get candidateModels(): readonly string[] {
    return PROVIDER_SPECS.anthropic.candidates;
  }

  private modelFor(options?: GenerationOptions): string {
    return options?.model?.trim() || this.defaultModel;
  }

  /**
   * Models on the current request surface: adaptive thinking is ON by default,
   * and `temperature` / `top_p` / `top_k` are rejected outright.
   *
   * Both matter, and both bit this pipeline on 2026-08-15:
   *
   *  - `max_tokens` is a hard cap on **thinking plus response text**, not just
   *    the response. Every generateCompletion call passed max_tokens 1400 with
   *    no `thinking` field, so on claude-sonnet-5 the model spent ~1385 tokens
   *    thinking and had nothing left for the answer. That surfaced as
   *    `stop_reason: max_tokens` with no text block — i.e. the provider's
   *    "No text content in response", classified as transient and retried
   *    against a second exhausted provider. It looked exactly like a credit
   *    problem and was not one.
   *  - `temperature` is a 400. campaign timeline/idea generation passes 0.7,
   *    so those paths would have failed as soon as they were exercised.
   *
   * Matched by prefix so date-suffixed ids and future point releases inherit it.
   */
  private static readonly ADAPTIVE_THINKING_PREFIXES = [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-mythos-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
  ];

  private isAdaptiveThinkingModel(model: string): boolean {
    return AnthropicProvider.ADAPTIVE_THINKING_PREFIXES.some((p) => model.startsWith(p));
  }

  /**
   * Room for thinking on top of whatever the caller budgeted for text.
   *
   * Added rather than substituted: callers size `max_tokens` for the piece they
   * want (a 280-char tweet needs very little), and that intent stays correct —
   * this only stops thinking from eating it. Effort is pinned to `low` because
   * this is short-form copy against an explicit rule set, not open-ended
   * reasoning, and thinking tokens are billed on every one of the several
   * hundred pieces a campaign launch generates.
   */
  private static readonly THINKING_HEADROOM_TOKENS = 6000;

  /**
   * Build the model-specific half of a messages.create() call.
   *
   * Returned as a spread rather than set inline so generateCompletion,
   * generateStructured, and validateConfig cannot drift apart — the original
   * bug was only reachable because each built its own request.
   */
  private requestParams(model: string, options?: GenerationOptions, defaultMaxTokens = 2048) {
    const requested = options?.max_tokens || defaultMaxTokens;

    if (!this.isAdaptiveThinkingModel(model)) {
      return {
        max_tokens: requested,
        ...(options?.temperature != null ? { temperature: options.temperature } : {}),
      };
    }

    return {
      max_tokens: requested + AnthropicProvider.THINKING_HEADROOM_TOKENS,
      thinking: { type: 'adaptive' as const },
      output_config: { effort: 'low' as const },
      // temperature deliberately dropped — a 400 on these models.
    };
  }

  private ensureClient(): Anthropic {
    if (!this.available) {
      throw new LLMProviderUnavailableError(this.name);
    }
    if (!this.client) {
      const baseURL = providerBaseUrl('anthropic');
      this.client = new Anthropic({
        apiKey: providerApiKey('anthropic'),
        ...(baseURL ? { baseURL } : {}),
      });
    }
    return this.client;
  }

  async generateCompletion(
    prompt: string,
    options?: GenerationOptions
  ): Promise<string> {
    const client = this.ensureClient();
    const model = this.modelFor(options);

    const response = await client.messages.create({
      model,
      ...this.requestParams(model, options),
      system: options?.system_prompt,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error(this.noTextError(response));
    }

    return textContent.text;
  }

  /**
   * A no-text response is almost always a budget problem, not a provider
   * problem. Say which, so it is not misread as an outage and retried against
   * another provider — that misdiagnosis is what made the original failure
   * look like exhausted API credits.
   */
  private noTextError(response: { stop_reason?: string | null; content: { type: string }[] }): string {
    const blocks = response.content.map((b) => b.type).join(', ') || 'none';
    if (response.stop_reason === 'max_tokens') {
      return (
        'Anthropic returned no text block: the response hit max_tokens ' +
        `(blocks: ${blocks}). On adaptive-thinking models max_tokens covers thinking ` +
        'plus text — raise it or lower effort.'
      );
    }
    return `Anthropic returned no text block (stop_reason: ${response.stop_reason ?? 'unknown'}, blocks: ${blocks})`;
  }

  async generateStructured<T>(
    prompt: string,
    schema: StructuredSchema<T>,
    options?: GenerationOptions
  ): Promise<T> {
    const client = this.ensureClient();

    // Use simple generic JSON schema - actual validation done by Zod after parsing
    const jsonSchema = {
      name: 'output',
      description: schema.description,
      input_schema: {
        type: 'object' as const,
        properties: {},
        additionalProperties: true,
      },
    };

    const model = this.modelFor(options);
    const response = await client.messages.create({
      model,
      ...this.requestParams(model, options),
      system: `${options?.system_prompt || ''}

You MUST respond with valid JSON that matches this schema:
${JSON.stringify(jsonSchema.input_schema, null, 2)}`,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error(this.noTextError(response));
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = textContent.text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new LLMProviderValidationError(
        this.name,
        `Failed to parse JSON response: ${textContent.text}`
      );
    }

    const validated = schema.schema.safeParse(parsed);
    if (!validated.success) {
      throw new LLMProviderValidationError(
        this.name,
        `Response does not match schema: ${validated.error.message}`
      );
    }

    return validated.data;
  }

  getCost(): { input_per_1k: number; output_per_1k: number } {
    // Claude 3.5 Opus pricing (as of 2025-01)
    return {
      input_per_1k: 0.003,   // $3 per 1M input tokens
      output_per_1k: 0.015,  // $15 per 1M output tokens
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.available) {
      return false;
    }

    try {
      const client = this.ensureClient();
      const model = this.defaultModel;
      const response = await client.messages.create({
        model,
        // Via requestParams so the health check can't pass on a budget the real
        // calls don't get — a bare max_tokens: 10 here would be consumed
        // entirely by thinking and report the provider as broken.
        ...this.requestParams(model, { max_tokens: 32 }),
        messages: [
          {
            role: 'user',
            content: 'OK',
          },
        ],
      });
      return !!response.content;
    } catch {
      return false;
    }
  }
}
