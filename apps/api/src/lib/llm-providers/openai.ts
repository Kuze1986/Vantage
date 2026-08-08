/**
 * OpenAI Provider
 * Key: OPENAI_API_KEY · Model: OPENAI_MODEL · Base URL: OPENAI_BASE_URL
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderName } from './models.js';

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'openai';

  getCost(): { input_per_1k: number; output_per_1k: number } {
    // GPT-4o pricing (as of 2025-01)
    return {
      input_per_1k: 0.005,   // $5 per 1M input tokens
      output_per_1k: 0.015,  // $15 per 1M output tokens
    };
  }
}
