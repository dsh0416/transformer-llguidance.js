import { describe, it, expect, vi } from 'vitest';
import { extractTokenizerData, type TransformersTokenizer } from '../src/tokenizer-bridge';

describe('extractTokenizerData', () => {
  describe('with getVocab method', () => {
    it('should extract vocabulary from getVocab()', () => {
      const mockTokenizer: TransformersTokenizer = {
        getVocab: () => ({
          hello: 0,
          world: 1,
          '!': 2,
        }),
        model: {
          merges: ['h e', 'l l', 'o w'],
        },
        added_tokens: [
          { id: 100, content: '<|endoftext|>', special: true },
        ],
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.vocab).toEqual({
        hello: 0,
        world: 1,
        '!': 2,
      });
      expect(result.merges).toEqual(['h e', 'l l', 'o w']);
      expect(result.added_tokens).toHaveLength(1);
      expect(result.added_tokens![0].content).toBe('<|endoftext|>');
      expect(result.added_tokens![0].special).toBe(true);
    });
  });

  describe('with model.vocab', () => {
    it('should extract vocabulary from model.vocab Record', () => {
      const mockTokenizer: TransformersTokenizer = {
        model: {
          vocab: {
            foo: 0,
            bar: 1,
          },
        },
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.vocab).toEqual({
        foo: 0,
        bar: 1,
      });
    });

    it('should extract vocabulary from model.vocab Map', () => {
      const vocabMap = new Map<string, number>([
        ['alpha', 0],
        ['beta', 1],
      ]);

      const mockTokenizer: TransformersTokenizer = {
        model: {
          vocab: vocabMap,
        },
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.vocab).toEqual({
        alpha: 0,
        beta: 1,
      });
    });
  });

  describe('with direct vocab property', () => {
    it('should extract vocabulary from vocab property', () => {
      const mockTokenizer: TransformersTokenizer = {
        vocab: {
          direct: 0,
          access: 1,
        },
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.vocab).toEqual({
        direct: 0,
        access: 1,
      });
    });
  });

  describe('error handling', () => {
    it('should throw error when no vocabulary source is found', () => {
      const mockTokenizer: TransformersTokenizer = {};

      expect(() => extractTokenizerData(mockTokenizer)).toThrow(
        'Unable to extract vocabulary from tokenizer',
      );
    });
  });

  describe('added_tokens handling', () => {
    it('should provide default values for optional fields', () => {
      const mockTokenizer: TransformersTokenizer = {
        vocab: { a: 0 },
        added_tokens: [
          { id: 50, content: '<pad>' },
        ],
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.added_tokens).toHaveLength(1);
      expect(result.added_tokens![0]).toEqual({
        id: 50,
        content: '<pad>',
        single_word: false,
        lstrip: false,
        rstrip: false,
        normalized: true,
        special: false,
      });
    });
  });

  describe('model type detection', () => {
    it('should detect BPE tokenizer from merges', () => {
      const mockTokenizer: TransformersTokenizer = {
        vocab: { a: 0 },
        model: {
          merges: ['a b', 'c d'],
        },
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.model_type).toBe('bpe');
    });

    it('should return unknown for tokenizers without merges', () => {
      const mockTokenizer: TransformersTokenizer = {
        vocab: { a: 0 },
      };

      const result = extractTokenizerData(mockTokenizer);

      expect(result.model_type).toBe('unknown');
    });
  });
});

