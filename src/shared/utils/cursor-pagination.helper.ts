import { CursorUtil } from './cursor.util';

export interface BuildCursorPaginatedResponseParams<T> {
  /** Items returned from DB (should include +1 overfetch) */
  items: T[];
  /** Requested page size */
  limit: number;
  /** The cursor ID used for the current request (null for first page) */
  cursorId: string | null;
  /** Extract the record ID from an item */
  getId: (item: T) => string;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    previousCursor: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    limit: number;
  };
}

/**
 * Build a cursor-paginated response from overfetched items.
 *
 * The DB query should fetch `limit + 1` items. If we get more than
 * `limit`, we trim the extra and set hasNextPage = true.
 */
export function buildCursorPaginatedResponse<T>({
  items,
  limit,
  cursorId,
  getId,
}: BuildCursorPaginatedResponseParams<T>): CursorPaginatedResult<T> {
  const hasNextPage = items.length > limit;
  const data = hasNextPage ? items.slice(0, limit) : items;

  const hasPreviousPage = cursorId !== null;

  const nextCursor =
    hasNextPage && data.length > 0
      ? CursorUtil.encode(getId(data[data.length - 1]))
      : null;

  const previousCursor =
    hasPreviousPage && data.length > 0
      ? CursorUtil.encode(getId(data[0]))
      : null;

  return {
    data,
    pagination: {
      nextCursor,
      previousCursor,
      hasNextPage,
      hasPreviousPage,
      limit,
    },
  };
}
