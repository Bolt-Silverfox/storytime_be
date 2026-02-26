import { buildCursorPaginatedResponse } from './cursor-pagination.helper';
import { CursorUtil } from './cursor.util';

interface TestItem {
  id: string;
  name: string;
}

const makeItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `id-${i + 1}`,
    name: `Item ${i + 1}`,
  }));

describe('buildCursorPaginatedResponse', () => {
  const getId = (item: TestItem) => item.id;

  it('should handle first page with more items available', () => {
    // DB returned limit+1 items (overfetch)
    const items = makeItems(4); // limit=3, got 4
    const result = buildCursorPaginatedResponse({
      items,
      limit: 3,
      cursorId: null,
      getId,
    });

    expect(result.data).toHaveLength(3);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPreviousPage).toBe(false);
    expect(result.pagination.nextCursor).not.toBeNull();
    expect(result.pagination.previousCursor).toBeNull();
    expect(result.pagination.limit).toBe(3);

    // nextCursor should decode to last item's ID
    const decodedNext = CursorUtil.decode(result.pagination.nextCursor!);
    expect(decodedNext).toBe('id-3');
  });

  it('should handle middle page', () => {
    const items = makeItems(4); // limit=3, got 4
    const result = buildCursorPaginatedResponse({
      items,
      limit: 3,
      cursorId: 'some-previous-id',
      getId,
    });

    expect(result.data).toHaveLength(3);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPreviousPage).toBe(true);
    expect(result.pagination.nextCursor).not.toBeNull();
    expect(result.pagination.previousCursor).not.toBeNull();

    // previousCursor should decode to first item's ID
    const decodedPrev = CursorUtil.decode(result.pagination.previousCursor!);
    expect(decodedPrev).toBe('id-1');
  });

  it('should handle last page (fewer items than limit)', () => {
    const items = makeItems(2); // limit=3, got 2
    const result = buildCursorPaginatedResponse({
      items,
      limit: 3,
      cursorId: 'some-previous-id',
      getId,
    });

    expect(result.data).toHaveLength(2);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPreviousPage).toBe(true);
    expect(result.pagination.nextCursor).toBeNull();
    expect(result.pagination.previousCursor).not.toBeNull();
  });

  it('should handle exact page size (no overfetch)', () => {
    const items = makeItems(3); // limit=3, got exactly 3
    const result = buildCursorPaginatedResponse({
      items,
      limit: 3,
      cursorId: null,
      getId,
    });

    expect(result.data).toHaveLength(3);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPreviousPage).toBe(false);
    expect(result.pagination.nextCursor).toBeNull();
  });

  it('should handle empty results', () => {
    const result = buildCursorPaginatedResponse({
      items: [],
      limit: 10,
      cursorId: null,
      getId,
    });

    expect(result.data).toHaveLength(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPreviousPage).toBe(false);
    expect(result.pagination.nextCursor).toBeNull();
    expect(result.pagination.previousCursor).toBeNull();
  });

  it('should handle empty results with cursor (all items before cursor deleted)', () => {
    const result = buildCursorPaginatedResponse({
      items: [],
      limit: 10,
      cursorId: 'some-cursor',
      getId,
    });

    expect(result.data).toHaveLength(0);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPreviousPage).toBe(true);
    expect(result.pagination.nextCursor).toBeNull();
    expect(result.pagination.previousCursor).toBeNull();
  });
});
