export interface SanitizeLimitOptions {
  defaultValue?: number;
  min?: number;
  max?: number;
}

export class PaginationUtil {
  /**
   * Sanitizes page and limit query parameters.
   * Default limit is 10. Max limit is enforced (default 100).
   */
  static sanitize(page: any, limit: any, maxLimit = 100) {
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
   * @param value - The limit value to sanitize
   * @param options - Configuration options
   * @returns Sanitized limit as a positive integer
   */
  static sanitizeLimit(
    value: unknown,
    options: SanitizeLimitOptions = {},
  ): number {
    const { defaultValue = 10, min = 1, max = 100 } = options;

    let result = Number(value);

    if (!Number.isFinite(result) || Number.isNaN(result)) {
      result = defaultValue;
    }

    result = Math.floor(result);
    return Math.max(min, Math.min(max, result));
  }
}
