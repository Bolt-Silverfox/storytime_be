/** Default page size for cursor-based pagination. */
export const DEFAULT_CURSOR_LIMIT = 20;

export interface CursorPaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

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
   * Sanitizes cursor-based pagination parameters.
   * @param cursor - The cursor string (last record ID)
   * @param limit - The page size limit
   * @param maxLimit - Maximum allowed limit (default 50)
   * @returns Sanitized cursor and limit
   */
  static sanitizeCursorParams(cursor: unknown, limit: unknown, maxLimit = 50) {
    const sanitizedCursor =
      typeof cursor === 'string' && cursor.trim().length > 0
        ? cursor.trim()
        : undefined;

    // Only return a limit when the client explicitly requested cursor pagination
    const hasLimit = limit !== undefined && limit !== null && limit !== '';
    if (!sanitizedCursor && !hasLimit) {
      return { cursor: undefined, limit: undefined };
    }

    const sanitizedLimit = PaginationUtil.sanitizeLimit(limit, {
      defaultValue: DEFAULT_CURSOR_LIMIT,
      max: maxLimit,
    });
    return { cursor: sanitizedCursor, limit: sanitizedLimit };
  }

  /**
   * Builds a cursor-paginated response from a "take N+1" result set.
   * Uses `slice` instead of `pop` to avoid mutating the input array.
   *
   * @param records - The fetched records (should have `limit + 1` items if there is a next page)
   * @param limit - The requested page size
   * @param getCursorId - Optional function to extract cursor ID (defaults to `record.id`)
   */
  static buildCursorResponse<T>(
    records: T[],
    limit: number,
    getCursorId: (item: T) => string = (item) => (item as { id: string }).id,
  ): CursorPaginatedResponse<T> {
    const hasNextPage = records.length > limit;
    const data = hasNextPage ? records.slice(0, limit) : records;
    return {
      data,
      pagination: {
        nextCursor:
          hasNextPage && data.length > 0
            ? getCursorId(data[data.length - 1])
            : null,
        hasNextPage,
      },
    };
  }
}
