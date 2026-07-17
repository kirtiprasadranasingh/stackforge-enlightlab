import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google Gemini client — StackForge generation engine.
 * Lazy init so builds succeed without a key present.
 */

let _client: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }
  // AI Studio keys look like AIza... — other Google tokens cause 401 ACCESS_TOKEN_TYPE_UNSUPPORTED
  if (!key.startsWith('AIza')) {
    console.warn(
      'GEMINI_API_KEY does not look like an AI Studio key (expected to start with AIza). Get one from https://aistudio.google.com/apikey'
    );
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(key);
  }
  return _client;
}

/** Strong model for coherent infra scaffolds */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Bound output size / cost — 16k truncates multi-file Azure/AWS scaffolds mid-stream */
export const MAX_OUTPUT_TOKENS = 32_768;
