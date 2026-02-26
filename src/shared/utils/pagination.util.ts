export interface SanitizeLimitOptions {
  defaultValue?: number;
  min?: number;
  max?: number;
}

import { CursorUtil } from './cursor.util';

export class PaginationUtil {
  /**
   * Sanitizes page and limit query parameters.
   * Default limit is 10. Max limit is enforced (default 100).
   */
  static sanitize(page: unknown, limit: unknown, maxLimit = 100) {
    const pageNumber = Math.max(1, Number(page) || 1);
    let limitNumber = Number(limit) || 10;

    if (limitNumber < 1) {
      limitNumber = 10;
    }

    if (limitNumber > maxLimit) {
      limitNumber = maxLimit;
    }

    return {
      page: pageNumber,
      limit: limitNumber,
    };
  }

  /**
   * Sanitizes a single limit value.
   * Ensures the value is a positive integer within bounds.
   * Also validates and normalizes the options themselves.
   * @param value - The limit value to sanitize
   * @param options - Configuration options
   * @returns Sanitized limit as a positive integer
   */
  static sanitizeLimit(
    value: unknown,
    options: SanitizeLimitOptions = {},
  ): number {
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
    let defaultValue = Number(options.defaultValue);
    if (!Number.isFinite(defaultValue)) {
      defaultValue = DEFAULT_VALUE;
    }
    defaultValue = Math.max(min, Math.min(max, defaultValue));

    // Coerce incoming value to number
    let result = Number(value);

    // Use validated defaultValue when non-finite
    if (!Number.isFinite(result)) {
      result = defaultValue;
    }

    // Floor and clamp to [min, max]
    result = Math.floor(result);
    return Math.max(min, Math.min(max, result));
  }

  /**
   * Sanitize cursor pagination parameters.
   * Decodes the cursor and clamps the limit.
   * Returns null cursorId for invalid cursors (starts from beginning).
   */
  static sanitizeCursorParams(
    cursor: string | undefined,
    limit: unknown,
    maxLimit = 100,
  ): { cursorId: string | null; limit: number } {
    const cursorId = cursor ? CursorUtil.decode(cursor) : null;
    const sanitizedLimit = PaginationUtil.sanitizeLimit(limit, {
      defaultValue: 10,
      max: maxLimit,
    });
    return { cursorId, limit: sanitizedLimit };
  }
}
