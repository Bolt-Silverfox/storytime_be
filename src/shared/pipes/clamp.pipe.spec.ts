import { ClampPipe, ClampPipeOptions } from './clamp.pipe';
import { ArgumentMetadata } from '@nestjs/common';

describe('ClampPipe', () => {
  const mockMetadata: ArgumentMetadata = {
    type: 'query',
    metatype: Number,
    data: 'limit',
  };

  describe('constructor with default options', () => {
    let pipe: ClampPipe;

    beforeEach(() => {
      pipe = new ClampPipe();
    });

    it('should use default min of 1', () => {
      expect(pipe.transform(0, mockMetadata)).toBe(1);
    });

    it('should use default max of 100', () => {
      expect(pipe.transform(150, mockMetadata)).toBe(100);
    });

    it('should use default value of 10 for invalid input', () => {
      expect(pipe.transform(undefined, mockMetadata)).toBe(10); // undefined → NaN → default
      expect(pipe.transform('invalid', mockMetadata)).toBe(10); // 'invalid' → NaN → default
      expect(pipe.transform(NaN, mockMetadata)).toBe(10);
    });

    it('should clamp null and empty string to min (they coerce to 0)', () => {
      // Note: Number(null) = 0, Number('') = 0
      expect(pipe.transform(null, mockMetadata)).toBe(1); // 0 clamped to min
      expect(pipe.transform('', mockMetadata)).toBe(1); // 0 clamped to min
    });
  });

  describe('constructor with custom options', () => {
    it('should use custom min value', () => {
      const pipe = new ClampPipe({ min: 5 });
      expect(pipe.transform(3, mockMetadata)).toBe(5);
    });

    it('should use custom max value', () => {
      const pipe = new ClampPipe({ max: 50 });
      expect(pipe.transform(75, mockMetadata)).toBe(50);
    });

    it('should use custom default value', () => {
      const pipe = new ClampPipe({ default: 25 });
      expect(pipe.transform(undefined, mockMetadata)).toBe(25);
    });

    it('should swap min and max if inverted', () => {
      const pipe = new ClampPipe({ min: 100, max: 10 });
      // After swap: min=10, max=100
      expect(pipe.transform(5, mockMetadata)).toBe(10);
      expect(pipe.transform(150, mockMetadata)).toBe(100);
    });

    it('should clamp default value to min/max range', () => {
      const pipe = new ClampPipe({ min: 20, max: 30, default: 50 });
      // Default should be clamped to 30
      expect(pipe.transform(undefined, mockMetadata)).toBe(30);

      const pipe2 = new ClampPipe({ min: 20, max: 30, default: 5 });
      // Default should be clamped to 20
      expect(pipe2.transform(undefined, mockMetadata)).toBe(20);
    });

    it('should handle invalid min option', () => {
      const pipe = new ClampPipe({ min: NaN } as ClampPipeOptions);
      // Should fall back to default min of 1
      expect(pipe.transform(0, mockMetadata)).toBe(1);
    });

    it('should handle invalid max option', () => {
      const pipe = new ClampPipe({ max: Infinity } as ClampPipeOptions);
      // Should fall back to default max of 100
      expect(pipe.transform(150, mockMetadata)).toBe(100);
    });

    it('should handle invalid default option', () => {
      const pipe = new ClampPipe({ default: NaN } as ClampPipeOptions);
      // Should fall back to default value of 10
      expect(pipe.transform(undefined, mockMetadata)).toBe(10);
    });
  });

  describe('transform method', () => {
    let pipe: ClampPipe;

    beforeEach(() => {
      pipe = new ClampPipe({ min: 1, max: 100, default: 10 });
    });

    it('should return the value when within range', () => {
      expect(pipe.transform(50, mockMetadata)).toBe(50);
      expect(pipe.transform(1, mockMetadata)).toBe(1);
      expect(pipe.transform(100, mockMetadata)).toBe(100);
    });

    it('should clamp values below min to min', () => {
      expect(pipe.transform(0, mockMetadata)).toBe(1);
      expect(pipe.transform(-10, mockMetadata)).toBe(1);
      expect(pipe.transform(-Infinity, mockMetadata)).toBe(10); // -Infinity is not finite, uses default
    });

    it('should clamp values above max to max', () => {
      expect(pipe.transform(101, mockMetadata)).toBe(100);
      expect(pipe.transform(1000, mockMetadata)).toBe(100);
    });

    it('should floor decimal values', () => {
      expect(pipe.transform(50.9, mockMetadata)).toBe(50);
      expect(pipe.transform(50.1, mockMetadata)).toBe(50);
      expect(pipe.transform(1.999, mockMetadata)).toBe(1);
    });

    it('should parse numeric strings', () => {
      expect(pipe.transform('50', mockMetadata)).toBe(50);
      expect(pipe.transform('1', mockMetadata)).toBe(1);
      expect(pipe.transform('100', mockMetadata)).toBe(100);
      expect(pipe.transform('50.5', mockMetadata)).toBe(50);
    });

    it('should use default for non-numeric strings', () => {
      expect(pipe.transform('abc', mockMetadata)).toBe(10);
      expect(pipe.transform('10abc', mockMetadata)).toBe(10); // NaN from Number()
    });

    it('should clamp empty string and null to min (they coerce to 0)', () => {
      // Number('') = 0, Number(null) = 0
      expect(pipe.transform('', mockMetadata)).toBe(1);
      expect(pipe.transform(null, mockMetadata)).toBe(1);
    });

    it('should use default for undefined', () => {
      expect(pipe.transform(undefined, mockMetadata)).toBe(10);
    });

    it('should use default for NaN', () => {
      expect(pipe.transform(NaN, mockMetadata)).toBe(10);
    });

    it('should use default for Infinity', () => {
      expect(pipe.transform(Infinity, mockMetadata)).toBe(10);
      expect(pipe.transform(-Infinity, mockMetadata)).toBe(10);
    });

    it('should handle negative numbers correctly', () => {
      const negativePipe = new ClampPipe({ min: -50, max: 50, default: 0 });
      expect(negativePipe.transform(-25, mockMetadata)).toBe(-25);
      expect(negativePipe.transform(-100, mockMetadata)).toBe(-50);
      expect(negativePipe.transform(100, mockMetadata)).toBe(50);
    });

    it('should handle zero correctly', () => {
      const zeroPipe = new ClampPipe({ min: 0, max: 100, default: 10 });
      expect(zeroPipe.transform(0, mockMetadata)).toBe(0);
      expect(zeroPipe.transform(-1, mockMetadata)).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle min equal to max', () => {
      const pipe = new ClampPipe({ min: 50, max: 50, default: 50 });
      expect(pipe.transform(0, mockMetadata)).toBe(50);
      expect(pipe.transform(100, mockMetadata)).toBe(50);
      expect(pipe.transform(50, mockMetadata)).toBe(50);
    });

    it('should handle very large numbers', () => {
      const pipe = new ClampPipe({ min: 1, max: Number.MAX_SAFE_INTEGER });
      expect(pipe.transform(Number.MAX_SAFE_INTEGER, mockMetadata)).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });

    it('should handle very small numbers', () => {
      const pipe = new ClampPipe({
        min: Number.MIN_SAFE_INTEGER,
        max: -1,
        default: -10,
      });
      expect(pipe.transform(Number.MIN_SAFE_INTEGER, mockMetadata)).toBe(
        Number.MIN_SAFE_INTEGER,
      );
    });

    it('should handle object input', () => {
      const pipe = new ClampPipe();
      expect(pipe.transform({}, mockMetadata)).toBe(10);
      expect(pipe.transform({ value: 50 }, mockMetadata)).toBe(10);
    });

    it('should handle array input', () => {
      const pipe = new ClampPipe();
      // Number([]) = 0, clamped to min=1
      expect(pipe.transform([], mockMetadata)).toBe(1);
      // Number([50]) = 50
      expect(pipe.transform([50], mockMetadata)).toBe(50);
      // Number([50, 60]) = NaN → default=10
      expect(pipe.transform([50, 60], mockMetadata)).toBe(10);
    });

    it('should handle boolean input', () => {
      const pipe = new ClampPipe();
      expect(pipe.transform(true, mockMetadata)).toBe(1); // true → 1
      expect(pipe.transform(false, mockMetadata)).toBe(1); // false → 0, clamped to min=1
    });
  });
});
