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

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly displayName = 'Claude (Anthropic)';

  private client: Anthropic | null = null;
  private model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-1-20250805';

  get available(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private ensureClient(): Anthropic {
    if (!this.available) {
      throw new LLMProviderUnavailableError(this.name);
    }
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  async generateCompletion(
    prompt: string,
    options?: GenerationOptions
  ): Promise<string> {
    const client = this.ensureClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature,
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
      throw new Error('No text content in response');
    }

    return textContent.text;
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

    const response = await client.messages.create({
      model: this.model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature,
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
      throw new Error('No text content in response');
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
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 10,
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
