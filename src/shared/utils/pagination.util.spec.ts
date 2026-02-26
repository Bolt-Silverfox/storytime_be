import { PaginationUtil } from './pagination.util';

describe('PaginationUtil.sanitizeCursorParams', () => {
  it('should return both undefined when no params provided', () => {
    const result = PaginationUtil.sanitizeCursorParams(undefined, undefined);
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should return both undefined for empty string cursor and no limit', () => {
    const result = PaginationUtil.sanitizeCursorParams('', undefined);
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should return both undefined for whitespace-only cursor and no limit', () => {
    const result = PaginationUtil.sanitizeCursorParams('   ', undefined);
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should return cursor and default limit when only cursor provided', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc-123', undefined);
    expect(result).toEqual({ cursor: 'abc-123', limit: 20 });
  });

  it('should trim cursor whitespace', () => {
    const result = PaginationUtil.sanitizeCursorParams(
      '  abc-123  ',
      undefined,
    );
    expect(result).toEqual({ cursor: 'abc-123', limit: 20 });
  });

  it('should return undefined cursor and sanitized limit when only limit provided', () => {
    const result = PaginationUtil.sanitizeCursorParams(undefined, '10');
    expect(result).toEqual({ cursor: undefined, limit: 10 });
  });

  it('should return both when cursor and limit provided', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc-123', '15');
    expect(result).toEqual({ cursor: 'abc-123', limit: 15 });
  });

  it('should clamp limit to maxLimit', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc-123', '100', 50);
    expect(result).toEqual({ cursor: 'abc-123', limit: 50 });
  });

  it('should use default limit of 20 for invalid limit string', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc-123', 'invalid');
    expect(result).toEqual({ cursor: 'abc-123', limit: 20 });
  });

  it('should treat null cursor as undefined', () => {
    const result = PaginationUtil.sanitizeCursorParams(null, undefined);
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should treat null limit as no limit', () => {
    const result = PaginationUtil.sanitizeCursorParams(undefined, null);
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should treat empty string limit as no limit', () => {
    const result = PaginationUtil.sanitizeCursorParams(undefined, '');
    expect(result).toEqual({ cursor: undefined, limit: undefined });
  });

  it('should clamp numeric 0 limit to 1', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc', 0);
    expect(result).toEqual({ cursor: 'abc', limit: 1 });
  });

  it('should clamp negative limit to 1', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc', '-5');
    expect(result).toEqual({ cursor: 'abc', limit: 1 });
  });

  it('should clamp string zero limit to 1', () => {
    const result = PaginationUtil.sanitizeCursorParams('abc', '0');
    expect(result).toEqual({ cursor: 'abc', limit: 1 });
  });
});
