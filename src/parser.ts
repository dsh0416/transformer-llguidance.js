import type { Grammar, TokenizerData } from './types';

/**
 * GuidanceParser wraps the llguidance WASM module and provides
 * a high-level interface for grammar-based token validation.
 */
export class GuidanceParser {
  private wasmParser: unknown;
  private _isInitialized: boolean = false;

  private constructor() {
    // Private constructor - use static create() method
  }

  /**
   * Create a new GuidanceParser instance
   * @param grammar The grammar definition (JSON Schema, Regex, or Lark)
   * @param tokenizer The tokenizer data from transformer.js
   */
  static async create(
    grammar: Grammar,
    tokenizer: TokenizerData,
  ): Promise<GuidanceParser> {
    const parser = new GuidanceParser();
    await parser.initialize(grammar, tokenizer);
    return parser;
  }

  private async initialize(
    grammar: Grammar,
    tokenizer: TokenizerData,
  ): Promise<void> {
    // Dynamic import of WASM module (bundler target auto-initializes via top-level await)
    const wasm = await import('../pkg/llguidance_wasm.js');

    // Convert grammar to the format expected by llguidance
    const grammarJson = JSON.stringify(this.convertGrammar(grammar));
    const tokenizerJson = JSON.stringify(tokenizer);

    // Initialize the WASM parser
    this.wasmParser = new wasm.LLGuidanceParser(grammarJson, tokenizerJson);
    this._isInitialized = true;
  }

  private convertGrammar(grammar: Grammar): Record<string, unknown> {
    switch (grammar.type) {
      case 'json_schema':
        return {
          grammars: [
            {
              json_schema: grammar.schema,
            },
          ],
        };
      case 'regex':
        return {
          grammars: [
            {
              rx: grammar.pattern,
            },
          ],
        };
      case 'lark':
        return {
          grammars: [
            {
              lark: grammar.grammar,
              start: grammar.startSymbol ?? 'start',
            },
          ],
        };
    }
  }

  /**
   * Check if a specific token is allowed at the current position
   * This is the fast path for speculative checking
   * @param tokenId The token ID to check
   * @returns true if the token is allowed
   */
  isTokenAllowed(tokenId: number): boolean {
    this.ensureInitialized();
    return (this.wasmParser as { is_token_allowed: (id: number) => boolean }).is_token_allowed(tokenId);
  }

  /**
   * Get the full token mask for the current position
   * This is the slow path used when speculation fails
   * @returns A Uint8Array where 1 = allowed, 0 = banned
   */
  getTokenMask(): Uint8Array {
    this.ensureInitialized();
    return (this.wasmParser as { get_token_mask: () => Uint8Array }).get_token_mask();
  }

  /**
   * Advance the parser state after a token has been selected
   * @param tokenId The token that was selected
   */
  advance(tokenId: number): void {
    this.ensureInitialized();
    (this.wasmParser as { advance: (id: number) => void }).advance(tokenId);
  }

  /**
   * Check if the current state represents a valid complete parse
   * @returns true if generation can terminate here
   */
  isComplete(): boolean {
    this.ensureInitialized();
    return (this.wasmParser as { is_complete: () => boolean }).is_complete();
  }

  /**
   * Reset the parser to its initial state with a new grammar
   * Useful for reusing the parser for a new generation
   * @param grammar Optional new grammar to reset to
   */
  reset(grammar?: Grammar): void {
    this.ensureInitialized();
    if (grammar) {
      const grammarJson = JSON.stringify(this.convertGrammar(grammar));
      (this.wasmParser as { reset: (json: string) => void }).reset(grammarJson);
    } else {
      // Reset with empty string uses the original grammar
      (this.wasmParser as { reset: (json: string) => void }).reset('');
    }
  }

  /**
   * Get the vocabulary size this parser was initialized with
   */
  get vocabSize(): number {
    this.ensureInitialized();
    return (this.wasmParser as { vocab_size: () => number }).vocab_size();
  }

  private ensureInitialized(): void {
    if (!this._isInitialized) {
      throw new Error(
        'GuidanceParser not initialized. Use GuidanceParser.create() to create an instance.',
      );
    }
  }
}

