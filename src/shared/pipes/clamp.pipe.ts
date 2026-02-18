import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

export interface ClampPipeOptions {
  /** Minimum allowed value (default: 1) */
  min?: number;
  /** Maximum allowed value (default: 100) */
  max?: number;
  /** Default value when input is invalid (default: 10) */
  default?: number;
}

/**
 * A pipe that clamps numeric values to a specified range.
 * Unlike ParseIntPipe, this pipe silently adjusts invalid values
 * rather than throwing validation errors.
 *
 * @example
 * // Basic usage with defaults (min: 1, max: 100, default: 10)
 * @Query('limit', ClampPipe) limit: number
 *
 * @example
 * // Custom options
 * @Query('limit', new ClampPipe({ min: 1, max: 50, default: 10 })) limit: number
 *
 * @example
 * // Combined with other pipes
 * @Query('page', new DefaultValuePipe(1), ClampPipe) page: number
 */
@Injectable()
export class ClampPipe implements PipeTransform<unknown, number> {
  private readonly min: number;
  private readonly max: number;
  private readonly defaultValue: number;

  constructor(options: ClampPipeOptions = {}) {
    const DEFAULT_MIN = 1;
    const DEFAULT_MAX = 100;
    const DEFAULT_VALUE = 10;

    // Validate and normalize min
    let min = Number(options.min);
    if (!Number.isFinite(min)) {
      min = DEFAULT_MIN;
    }

    // Validate and normalize max
    let max = Number(options.max);
    if (!Number.isFinite(max)) {
      max = DEFAULT_MAX;
    }

    // Ensure min <= max (swap if inverted)
    if (min > max) {
      [min, max] = [max, min];
    }

    // Validate and normalize defaultValue, clamp to [min, max]
    let defaultValue = Number(options.default);
    if (!Number.isFinite(defaultValue)) {
      defaultValue = DEFAULT_VALUE;
    }
    defaultValue = Math.max(min, Math.min(max, defaultValue));

    this.min = min;
    this.max = max;
    this.defaultValue = defaultValue;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transform(value: unknown, metadata: ArgumentMetadata): number {
    let result = Number(value);

    // Use default when non-finite
    if (!Number.isFinite(result)) {
      result = this.defaultValue;
    }

    // Floor and clamp to [min, max]
    result = Math.floor(result);
    return Math.max(this.min, Math.min(this.max, result));
  }
}
