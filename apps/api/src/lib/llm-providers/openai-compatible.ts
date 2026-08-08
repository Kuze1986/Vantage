/**
 * Shared base for every provider that speaks the OpenAI chat-completions protocol:
 * OpenAI itself, xAI Grok, Google Gemini (via its OpenAI-compatibility layer), and
 * Kimi/Moonshot. All four ride the `openai` SDK with a different baseURL and key,
 * so no additional npm dependency is needed for any of them.
 *
 * Request shapes are carried over verbatim from the original openai.ts/grok.ts so
 * behaviour is unchanged apart from where the model comes from.
 */

import OpenAI from 'openai';
import type { LLMProvider, GenerationOptions, StructuredSchema } from './types.js';
import { LLMProviderUnavailableError, LLMProviderValidationError } from './types.js';
import {
  PROVIDER_SPECS,
  providerApiKey,
  providerBaseUrl,
  providerConfigured,
  providerDefaultModel,
  type ProviderName,
} from './models.js';

/** Generic schema stub — real validation is done by Zod after parsing. */
const GENERIC_JSON_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: true,
} as const;

export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly name: ProviderName;

  private client: OpenAI | null = null;

  get displayName(): string {
    return PROVIDER_SPECS[this.name].displayName;
  }

  get available(): boolean {
    return providerConfigured(this.name);
  }

  get defaultModel(): string {
    return providerDefaultModel(this.name);
  }

  get candidateModels(): readonly string[] {
    return PROVIDER_SPECS[this.name].candidates;
  }

  protected modelFor(options?: GenerationOptions): string {
    return options?.model?.trim() || this.defaultModel;
  }

  protected ensureClient(): OpenAI {
    if (!this.available) {
      throw new LLMProviderUnavailableError(this.name);
    }
    if (!this.client) {
      const baseURL = providerBaseUrl(this.name);
      this.client = new OpenAI({
        apiKey: providerApiKey(this.name),
        ...(baseURL ? { baseURL } : {}),
      });
    }
    return this.client;
  }

  async generateCompletion(prompt: string, options?: GenerationOptions): Promise<string> {
    const client = this.ensureClient();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.system_prompt) {
      messages.push({ role: 'system', content: options.system_prompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: this.modelFor(options),
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }
    return content;
  }

  async generateStructured<T>(
    prompt: string,
    schema: StructuredSchema<T>,
    options?: GenerationOptions,
  ): Promise<T> {
    const client = this.ensureClient();

    const systemPrompt = `${options?.system_prompt || ''}

You MUST respond with valid JSON that matches this schema:
${JSON.stringify(GENERIC_JSON_SCHEMA, null, 2)}`;

    const response = await client.chat.completions.create({
      model: this.modelFor(options),
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = content;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1]!;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new LLMProviderValidationError(
        this.name,
        `Failed to parse JSON response: ${content}`,
      );
    }

    const validated = schema.schema.safeParse(parsed);
    if (!validated.success) {
      throw new LLMProviderValidationError(
        this.name,
        `Response does not match schema: ${validated.error.message}`,
      );
    }

    return validated.data;
  }

  abstract getCost(): { input_per_1k: number; output_per_1k: number };

  async validateConfig(): Promise<boolean> {
    if (!this.available) {
      return false;
    }
    try {
      const client = this.ensureClient();
      const response = await client.chat.completions.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'OK' }],
      });
      return !!response.choices[0]?.message?.content;
    } catch {
      return false;
    }
  }
}
