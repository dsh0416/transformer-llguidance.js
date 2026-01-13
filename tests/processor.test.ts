import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuidanceLogitsProcessor } from '../src/processor';
import type { GuidanceParser } from '../src/parser';

describe('GuidanceLogitsProcessor', () => {
  let mockParser: GuidanceParser;
  let processor: GuidanceLogitsProcessor;

  beforeEach(() => {
    // Create a mock parser
    mockParser = {
      isTokenAllowed: vi.fn(),
      getTokenMask: vi.fn(),
      advance: vi.fn(),
      isComplete: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
      vocabSize: 100,
    } as unknown as GuidanceParser;

    processor = new GuidanceLogitsProcessor(mockParser, {
      speculationDepth: 3,
      debug: false,
    });
  });

  describe('process() - speculative decoding', () => {
    it('should use fast path when top token is allowed', () => {
      // Setup: top token (id=5) is allowed
      (mockParser.isTokenAllowed as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // Create logits with token 5 having highest value
      const logits = new Float32Array(100);
      logits.fill(-10);
      logits[5] = 10; // Highest logit
      logits[3] = 5;  // Second highest
      logits[7] = 3;  // Third highest

      const result = processor.process([], logits);

      // Should only have checked isTokenAllowed, not getTokenMask
      expect(mockParser.isTokenAllowed).toHaveBeenCalled();
      expect(mockParser.getTokenMask).not.toHaveBeenCalled();

      // Result should have only token 5 as allowed
      expect(result[5]).toBe(10);
      expect(result[3]).toBe(-Infinity);
      expect(result[7]).toBe(-Infinity);
    });

    it('should try multiple tokens before falling back to full mask', () => {
      // Setup: first two tokens not allowed, third is
      const isAllowedMock = mockParser.isTokenAllowed as ReturnType<typeof vi.fn>;
      isAllowedMock.mockImplementation((tokenId: number) => tokenId === 7);

      const logits = new Float32Array(100);
      logits.fill(-10);
      logits[5] = 10; // Highest (not allowed)
      logits[3] = 5;  // Second (not allowed)
      logits[7] = 3;  // Third (allowed!)

      const result = processor.process([], logits);

      // Should have checked tokens in order of logit value
      expect(isAllowedMock).toHaveBeenCalledWith(5);
      expect(isAllowedMock).toHaveBeenCalledWith(3);
      expect(isAllowedMock).toHaveBeenCalledWith(7);

      // Should not have needed full mask
      expect(mockParser.getTokenMask).not.toHaveBeenCalled();

      // Result should mask all except token 7
      expect(result[7]).toBe(3);
      expect(result[5]).toBe(-Infinity);
    });

    it('should fall back to full mask when no top-k tokens are allowed', () => {
      // Setup: no top tokens allowed, need full mask
      (mockParser.isTokenAllowed as ReturnType<typeof vi.fn>).mockReturnValue(false);
      
      const fullMask = new Uint8Array(100);
      fullMask.fill(0);
      fullMask[50] = 1; // Only token 50 is allowed
      (mockParser.getTokenMask as ReturnType<typeof vi.fn>).mockReturnValue(fullMask);

      const logits = new Float32Array(100);
      logits.fill(1);
      logits[5] = 10;
      logits[50] = 2;

      const result = processor.process([], logits);

      // Should have tried speculation first
      expect(mockParser.isTokenAllowed).toHaveBeenCalled();
      
      // Should have fallen back to full mask
      expect(mockParser.getTokenMask).toHaveBeenCalled();

      // Result should only allow token 50
      expect(result[50]).toBe(2);
      expect(result[5]).toBe(-Infinity);
      expect(result[0]).toBe(-Infinity);
    });
  });

  describe('onToken()', () => {
    it('should advance parser and track generated tokens', () => {
      processor.onToken(42);
      
      expect(mockParser.advance).toHaveBeenCalledWith(42);
      expect(processor.getGeneratedTokens()).toEqual([42]);
    });

    it('should accumulate generated tokens', () => {
      processor.onToken(1);
      processor.onToken(2);
      processor.onToken(3);
      
      expect(processor.getGeneratedTokens()).toEqual([1, 2, 3]);
    });
  });

  describe('canStop()', () => {
    it('should return parser completion status', () => {
      (mockParser.isComplete as ReturnType<typeof vi.fn>).mockReturnValue(true);
      expect(processor.canStop()).toBe(true);

      (mockParser.isComplete as ReturnType<typeof vi.fn>).mockReturnValue(false);
      expect(processor.canStop()).toBe(false);
    });
  });

  describe('reset()', () => {
    it('should clear generated tokens and reset parser', () => {
      processor.onToken(1);
      processor.onToken(2);
      
      processor.reset();
      
      expect(mockParser.reset).toHaveBeenCalled();
      expect(processor.getGeneratedTokens()).toEqual([]);
    });
  });

  describe('debug mode', () => {
    it('should log when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const debugProcessor = new GuidanceLogitsProcessor(mockParser, {
        speculationDepth: 3,
        debug: true,
      });

      (mockParser.isTokenAllowed as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const logits = new Float32Array(100);
      logits[0] = 10;
      
      debugProcessor.process([], logits);
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

