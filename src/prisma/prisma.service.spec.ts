import { resolvePrismaDatasourceUrl } from './prisma.service';

describe('resolvePrismaDatasourceUrl', () => {
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
