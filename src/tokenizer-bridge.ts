/**
 * Tokenizer bridge utilities for converting transformer.js tokenizer format
 * to the format expected by llguidance WASM module.
 */

import type { TokenizerData } from './types';

/**
 * Represents a transformer.js tokenizer instance.
 * This is a minimal interface for the parts we need.
 */
export interface TransformersTokenizer {
  /** The model data containing vocabulary */
  model?: {
    vocab?: Map<string, number> | Record<string, number>;
    merges?: string[];
  };
  /** Direct vocab access for some tokenizer types */
  vocab?: Map<string, number> | Record<string, number>;
  /** Added tokens (special tokens) */
  added_tokens?: Array<{
    id: number;
    content: string;
    single_word?: boolean;
    lstrip?: boolean;
    rstrip?: boolean;
    normalized?: boolean;
    special?: boolean;
  }>;
  /** Get vocabulary method */
  getVocab?: () => Record<string, number>;
  /** Encode method for testing */
  encode?: (text: string) => number[];
}

/**
 * Extract tokenizer data from a transformer.js tokenizer instance.
 *
 * @param tokenizer The transformer.js tokenizer instance
 * @returns TokenizerData in the format expected by llguidance
 *
 * @example
 * ```typescript
 * import { AutoTokenizer } from '@huggingface/transformers';
 * import { extractTokenizerData } from 'llguidance-js';
 *
 * const tokenizer = await AutoTokenizer.from_pretrained('gpt2');
 * const tokenizerData = extractTokenizerData(tokenizer);
 * ```
 */
export function extractTokenizerData(
  tokenizer: TransformersTokenizer,
): TokenizerData {
  // Try to get vocabulary from various sources
  let vocab: Record<string, number>;

  if (tokenizer.getVocab) {
    // Preferred method - direct vocab access
    vocab = tokenizer.getVocab();
  } else if (tokenizer.model?.vocab) {
    // Some tokenizers store vocab in model
    vocab = mapToRecord(tokenizer.model.vocab);
  } else if (tokenizer.vocab) {
    // Direct vocab property
    vocab = mapToRecord(tokenizer.vocab);
  } else {
    throw new Error(
      'Unable to extract vocabulary from tokenizer. ' +
      'Ensure you are passing a valid transformer.js tokenizer instance.',
    );
  }

  // Get merges if available (for BPE tokenizers)
  const merges = tokenizer.model?.merges ?? [];

  // Get added tokens (special tokens)
  const added_tokens = (tokenizer.added_tokens ?? []).map((token) => ({
    id: token.id,
    content: token.content,
    single_word: token.single_word ?? false,
    lstrip: token.lstrip ?? false,
    rstrip: token.rstrip ?? false,
    normalized: token.normalized ?? true,
    special: token.special ?? false,
  }));

  return {
    vocab,
    merges,
    added_tokens,
    model_type: detectModelType(tokenizer),
  };
}

/**
 * Convert a Map or Record to a plain Record
 */
function mapToRecord(
  input: Map<string, number> | Record<string, number>,
): Record<string, number> {
  if (input instanceof Map) {
    const result: Record<string, number> = {};
    for (const [key, value] of input) {
      result[key] = value;
    }
    return result;
  }
  return input;
}

/**
 * Try to detect the tokenizer model type
 */
function detectModelType(tokenizer: TransformersTokenizer): string {
  // Check if it's a BPE tokenizer (has merges)
  if (tokenizer.model?.merges && tokenizer.model.merges.length > 0) {
    return 'bpe';
  }
  // Default to unknown
  return 'unknown';
}

/**
 * Load tokenizer data from a HuggingFace model ID.
 * This fetches the tokenizer.json file directly.
 *
 * @param modelId The HuggingFace model ID (e.g., 'gpt2', 'meta-llama/Llama-2-7b')
 * @param options Optional configuration
 * @returns TokenizerData in the format expected by llguidance
 *
 * @example
 * ```typescript
 * import { loadTokenizerData } from 'llguidance-js';
 *
 * const tokenizerData = await loadTokenizerData('gpt2');
 * ```
 */
export async function loadTokenizerData(
  modelId: string,
  options: {
    /** HuggingFace API token for private models */
    token?: string;
    /** Custom base URL for HuggingFace Hub */
    baseUrl?: string;
  } = {},
): Promise<TokenizerData> {
  const baseUrl = options.baseUrl ?? 'https://huggingface.co';
  const url = `${baseUrl}/${modelId}/resolve/main/tokenizer.json`;

  const headers: Record<string, string> = {};
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch tokenizer from ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const tokenizerJson = await response.json();
  return parseTokenizerJson(tokenizerJson);
}

/**
 * Parse a tokenizer.json file into TokenizerData format
 */
function parseTokenizerJson(json: unknown): TokenizerData {
  const data = json as {
    model?: {
      vocab?: Record<string, number>;
      merges?: string[];
      type?: string;
    };
    added_tokens?: Array<{
      id: number;
      content: string;
      single_word?: boolean;
      lstrip?: boolean;
      rstrip?: boolean;
      normalized?: boolean;
      special?: boolean;
    }>;
  };

  if (!data.model?.vocab) {
    throw new Error('Invalid tokenizer.json: missing model.vocab');
  }

  return {
    vocab: data.model.vocab,
    merges: data.model.merges ?? [],
    added_tokens: data.added_tokens?.map((token) => ({
      id: token.id,
      content: token.content,
      single_word: token.single_word ?? false,
      lstrip: token.lstrip ?? false,
      rstrip: token.rstrip ?? false,
      normalized: token.normalized ?? true,
      special: token.special ?? false,
    })),
    model_type: data.model.type ?? 'unknown',
  };
}

