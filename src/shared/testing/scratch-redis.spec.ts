import { assertScratchRedisUrl } from './scratch-redis';

describe('assertScratchRedisUrl', () => {
  it.each([
    'redis://127.0.0.1:6379/3',
    'redis://localhost:6380/15',
    'redis://[::1]:6379/1',
    'redis://:secret@127.0.0.1:6379/2',
  ])('accepts a loopback Redis on a dedicated database (%s)', (url) => {
    expect(() => assertScratchRedisUrl(url)).not.toThrow();
  });

  it.each([
    ['a remote host', 'redis://cache.internal:6379/3'],
    ['a TLS remote host', 'rediss://10.0.0.5:6380/3'],
    ['the default database', 'redis://127.0.0.1:6379/0'],
    ['no database', 'redis://127.0.0.1:6379'],
    ['a non-numeric database', 'redis://127.0.0.1:6379/x'],
    ['a non-Redis scheme', 'http://127.0.0.1:6379/3'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertScratchRedisUrl(url)).toThrow(
      /loopback Redis on a numbered database other than 0/,
    );
  });

  it('does not echo the URL, which may carry a password', () => {
    let message = '';
    try {
      assertScratchRedisUrl('redis://:hunter2@cache.internal:6379/3');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/loopback Redis/);
    expect(message).not.toContain('hunter2');
  });
});
