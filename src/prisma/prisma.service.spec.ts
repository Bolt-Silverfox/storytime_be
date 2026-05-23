import {
  parseConnectionLimit,
  resolvePrismaDatasourceUrl,
} from './prisma.service';

describe('resolvePrismaDatasourceUrl', () => {
  it('returns undefined when resolvePrismaDatasourceUrl receives undefined', () => {
    expect(resolvePrismaDatasourceUrl(undefined, 3)).toBeUndefined();
  });

  it('returns an empty string when resolvePrismaDatasourceUrl receives an empty string', () => {
    expect(resolvePrismaDatasourceUrl('', 3)).toBe('');
  });

  it('adds a default connection limit to direct postgres URLs', () => {
    expect(
      resolvePrismaDatasourceUrl(
        'postgresql://user:pass@localhost:5432/storytime_dev?schema=storytime',
        3,
      ),
    ).toBe(
      'postgresql://user:pass@localhost:5432/storytime_dev?schema=storytime&connection_limit=3',
    );
  });

  it('preserves an existing connection limit', () => {
    expect(
      resolvePrismaDatasourceUrl(
        'postgresql://user:pass@localhost:5432/storytime_dev?schema=storytime&connection_limit=7',
        3,
      ),
    ).toBe(
      'postgresql://user:pass@localhost:5432/storytime_dev?schema=storytime&connection_limit=7',
    );
  });

  it('leaves prisma accelerate URLs unchanged', () => {
    expect(
      resolvePrismaDatasourceUrl('prisma://accelerate.example.com', 3),
    ).toBe('prisma://accelerate.example.com');
  });

  it('returns the original URL when parsing fails', () => {
    expect(resolvePrismaDatasourceUrl('not-a-url', 3)).toBe('not-a-url');
  });
});

describe('parseConnectionLimit', () => {
  it('returns the fallback when parseConnectionLimit receives an empty string', () => {
    expect(parseConnectionLimit('')).toBe(3);
  });

  it('returns the fallback when parseConnectionLimit receives a non-numeric string', () => {
    expect(parseConnectionLimit('not-a-number')).toBe(3);
  });

  it('returns the fallback when parseConnectionLimit receives a negative number', () => {
    expect(parseConnectionLimit('-1')).toBe(3);
  });

  it('returns the fallback when parseConnectionLimit receives zero', () => {
    expect(parseConnectionLimit('0')).toBe(3);
  });

  it('returns the parsed value when parseConnectionLimit receives a valid integer', () => {
    expect(parseConnectionLimit('7')).toBe(7);
  });
});
