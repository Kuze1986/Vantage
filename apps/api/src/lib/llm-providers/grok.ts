/**
 * xAI Grok Provider — OpenAI-compatible API.
 * Key: XAI_API_KEY | GROK_API_KEY · Model: XAI_MODEL | GROK_MODEL · Base: XAI_BASE_URL
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderName } from './models.js';

export class GrokProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'grok';

  getCost(): { input_per_1k: number; output_per_1k: number } {
    return {
      input_per_1k: 0.005,
      output_per_1k: 0.015,
    };
  }
}
