/**
 * OpenAI Provider
 * Uses OPENAI_API_KEY environment variable
 */

import OpenAI from 'openai';
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

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly displayName = 'GPT-4o (OpenAI)';

  private client: OpenAI | null = null;
  private model = process.env.OPENAI_MODEL || 'gpt-4o';

  get available(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  private ensureClient(): OpenAI {
    if (!this.available) {
      throw new LLMProviderUnavailableError(this.name);
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
    return this.client;
  }

  async generateCompletion(
    prompt: string,
    options?: GenerationOptions
  ): Promise<string> {
    const client = this.ensureClient();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.system_prompt) {
      messages.push({
        role: 'system',
        content: options.system_prompt,
      });
    }
    messages.push({
      role: 'user',
      content: prompt,
    });

    const response = await client.chat.completions.create({
      model: this.model,
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
    options?: GenerationOptions
  ): Promise<T> {
    const client = this.ensureClient();

    // Build generic JSON schema (validation done by Zod)
    const jsonSchema = this.buildJsonSchema();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = `${options?.system_prompt || ''}

You MUST respond with valid JSON that matches this schema:
${JSON.stringify(jsonSchema, null, 2)}`;

    messages.push({
      role: 'system',
      content: systemPrompt,
    });
    messages.push({
      role: 'user',
      content: prompt,
    });

    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: options?.max_tokens || 2048,
      temperature: options?.temperature,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = content;
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
        `Failed to parse JSON response: ${content}`
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
    // GPT-4o pricing (as of 2025-01)
    return {
      input_per_1k: 0.005,   // $5 per 1M input tokens
      output_per_1k: 0.015,  // $15 per 1M output tokens
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.available) {
      return false;
    }

    try {
      const client = this.ensureClient();
      const response = await client.chat.completions.create({
        model: this.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'OK',
          },
        ],
      });
      return !!response.choices[0]?.message?.content;
    } catch {
      return false;
    }
  }

  private buildJsonSchema(): Record<string, any> {
    // Simple generic JSON schema - actual validation done by Zod
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    };
  }
}
