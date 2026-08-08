/**
 * Google Gemini Provider — via Google's OpenAI-compatibility endpoint.
 * Key: GEMINI_API_KEY | GOOGLE_API_KEY · Model: GEMINI_MODEL · Base: GEMINI_BASE_URL
 *
 * Uses the compat layer rather than @google/genai on purpose: it adds no dependency,
 * and the LLMProvider interface exposes none of Gemini's native-only features
 * (grounding, safety settings, native responseSchema), so the native SDK would buy
 * nothing today. If the beta compat layer misbehaves, GEMINI_BASE_URL redirects it
 * and the failover chain routes around it.
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderName } from './models.js';

export class GeminiProvider extends OpenAICompatibleProvider {
  readonly name: ProviderName = 'gemini';

  getCost(): { input_per_1k: number; output_per_1k: number } {
    // gemini-2.0-flash pricing
    return {
      input_per_1k: 0.0001,
      output_per_1k: 0.0004,
    };
  }
}
