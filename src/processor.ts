import { GuidanceParser } from './parser';
import type { ProcessorOptions } from './types';

/**
 * GuidanceLogitsProcessor implements the logits processor interface
 * compatible with transformer.js for constrained generation.
 *
 * It uses speculative checking to minimize the performance overhead
 * of grammar validation.
 */
export class GuidanceLogitsProcessor {
  private parser: GuidanceParser;
  private speculationDepth: number;
  private debug: boolean;
  private generatedTokens: number[] = [];

  constructor(parser: GuidanceParser, options: ProcessorOptions = {}) {
    this.parser = parser;
    this.speculationDepth = options.speculationDepth ?? 5;
    this.debug = options.debug ?? false;
  }

  /**
   * Process logits by masking tokens that violate the grammar.
   * This is the main interface called by transformer.js during generation.
   *
   * @param inputIds The current sequence of token IDs
   * @param logits The raw logits from the model (will be modified in place)
   * @returns The modified logits
   */
  process(inputIds: number[], logits: Float32Array): Float32Array {
    const topK = this.getTopK(logits, this.speculationDepth);

    if (this.debug) {
      console.log(`[GuidanceProcessor] Top-${this.speculationDepth} tokens:`, topK);
    }

    for (const { tokenId } of topK) {
      if (this.parser.isTokenAllowed(tokenId)) {
        if (this.debug) {
          console.log(`[GuidanceProcessor] Speculation hit: token ${tokenId}`);
        }
        return this.maskAllExcept(logits, tokenId);
      }
    }

    if (this.debug) {
      console.log('[GuidanceProcessor] Speculation miss, computing full mask');
    }

    const allowedMask = this.parser.getTokenMask();
    return this.applyBitmask(logits, allowedMask);
  }

  /**
   * Callback to be called after a token is sampled.
   * This advances the parser state.
   *
   * @param tokenId The token that was sampled
   */
  onToken(tokenId: number): void {
    this.generatedTokens.push(tokenId);
    this.parser.advance(tokenId);

    if (this.debug) {
      console.log(`[GuidanceProcessor] Advanced with token ${tokenId}`);
    }
  }

  /**
   * Check if generation can terminate at the current position
   */
  canStop(): boolean {
    return this.parser.isComplete();
  }

  /**
   * Reset the processor for a new generation
   */
  reset(): void {
    this.generatedTokens = [];
    this.parser.reset();
  }

  /**
   * Get the tokens generated so far
   */
  getGeneratedTokens(): number[] {
    return [...this.generatedTokens];
  }

  private getTopK(
    logits: Float32Array,
    k: number,
  ): Array<{ tokenId: number; logit: number }> {
    const indexed: Array<{ tokenId: number; logit: number }> = [];
    for (let i = 0; i < logits.length; i++) {
      indexed.push({ tokenId: i, logit: logits[i] });
    }
    indexed.sort((a, b) => b.logit - a.logit);
    return indexed.slice(0, k);
  }

  private maskAllExcept(logits: Float32Array, allowedToken: number): Float32Array {
    const masked = new Float32Array(logits.length).fill(-Infinity);
    masked[allowedToken] = logits[allowedToken];
    return masked;
  }

  private applyBitmask(logits: Float32Array, mask: Uint8Array): Float32Array {
    for (let i = 0; i < logits.length; i++) {
      if (mask[i] === 0) {
        logits[i] = -Infinity;
      }
    }
    return logits;
  }
}

