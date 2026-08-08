/**
 * Kimi (Moonshot) Provider — OpenAI-compatible API.
 * Key: KIMI_API_KEY | MOONSHOT_API_KEY · Model: KIMI_MODEL | MOONSHOT_MODEL
 * Base: KIMI_BASE_URL | MOONSHOT_BASE_URL
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderName } from './models.js';

export class KimiProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'kimi';

  getCost(): { input_per_1k: number; output_per_1k: number } {
    return {
      input_per_1k: 0.0006,
      output_per_1k: 0.0025,
    };
  }
}
