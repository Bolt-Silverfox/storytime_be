/**
 * Guards the jest transformIgnorePatterns allow-list in jest.config.js.
 * @nestjs/passport 12 and @nestjs/cache-manager 12 ship ESM only; jest's CJS
 * runtime can only load them if they are transformed. If this spec fails with
 * "Unexpected token 'export'" / ERR_REQUIRE_ESM, the allow-list regressed.
 *
 * What this proves: the packages import and export their main symbols under
 * jest's transform pipeline.
 * What it does NOT prove: that the production build loads them. Jest transforms
 * the ESM, plain Node does not go through that. The "Build" CI job covers that
 * separately by running `node` against the compiled `dist` output (see the
 * "Smoke-load built output" step in .github/workflows/dev-deploy.yml).
 */
describe('ESM-only Nest 12 packages load under jest', () => {
  it('@nestjs/passport exposes PassportStrategy and AuthGuard', async () => {
    const mod = await import('@nestjs/passport');
    expect(typeof mod.PassportStrategy).toBe('function');
    expect(typeof mod.AuthGuard).toBe('function');
    expect(typeof mod.PassportModule).toBe('function');
  });

  it('@nestjs/cache-manager exposes CacheModule and CACHE_MANAGER', async () => {
    const mod = await import('@nestjs/cache-manager');
    expect(typeof mod.CacheModule).toBe('function');
    expect(mod.CACHE_MANAGER).toBeDefined();
  });
});
