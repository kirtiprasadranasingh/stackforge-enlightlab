import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google Gemini client — StackForge generation engine.
 * Lazy init so builds succeed without a key present.
 */

let _client: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(key);
  }
  return _client;
}

/** Strong model for coherent infra scaffolds */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Bound output size / cost */
export const MAX_OUTPUT_TOKENS = 16_000;
