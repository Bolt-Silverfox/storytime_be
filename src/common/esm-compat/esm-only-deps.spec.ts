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
