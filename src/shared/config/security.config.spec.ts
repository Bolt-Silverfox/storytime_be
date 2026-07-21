import { swaggerCspDirectives } from './security.config';

describe('swaggerCspDirectives', () => {
  it('allows swagger-ui inline scripts but keeps self', () => {
    expect(swaggerCspDirectives.scriptSrc).toEqual(
      expect.arrayContaining(["'self'", "'unsafe-inline'"]),
    );
  });

  it('never allows unsafe-eval', () => {
    for (const values of Object.values(swaggerCspDirectives)) {
      expect(values).not.toContain("'unsafe-eval'");
    }
  });

  it('allows data: images (swagger-ui embeds inline images)', () => {
    expect(swaggerCspDirectives.imgSrc).toContain('data:');
  });

  it('only relaxes script/style/img — not default-src, object-src, or base-uri', () => {
    // Those stay at Helmet's strict defaults via useDefaults; overriding them
    // here would silently weaken the global-equivalent baseline for /docs.
    expect(Object.keys(swaggerCspDirectives).sort()).toEqual([
      'imgSrc',
      'scriptSrc',
      'styleSrc',
    ]);
  });
});
