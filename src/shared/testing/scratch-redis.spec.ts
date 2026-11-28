import { scratchRedisEndpoint } from './scratch-redis';

describe('scratchRedisEndpoint', () => {
  it.each([
    [
      'redis://127.0.0.1:6379/3',
      {
        host: '127.0.0.1',
        port: 6379,
        db: 3,
        username: undefined,
        password: undefined,
      },
    ],
    [
      'redis://localhost/15',
      {
        host: 'localhost',
        port: 6379,
        db: 15,
        username: undefined,
        password: undefined,
      },
    ],
    [
      'redis://[::1]:6380/1',
      {
        host: '::1',
        port: 6380,
        db: 1,
        username: undefined,
        password: undefined,
      },
    ],
    [
      'redis://user:p%40ss@127.0.0.1:6379/2',
      {
        host: '127.0.0.1',
        port: 6379,
        db: 2,
        username: 'user',
        password: 'p@ss',
      },
    ],
  ])('returns validated connection options for %s', (url, expected) => {
    expect(scratchRedisEndpoint(url)).toEqual(expected);
  });

  it.each([
    ['a remote host', 'redis://cache.internal:6379/3'],
    ['a TLS remote host', 'rediss://10.0.0.5:6380/3'],
    ['the default database', 'redis://127.0.0.1:6379/0'],
    ['no database', 'redis://127.0.0.1:6379'],
    ['a non-numeric database', 'redis://127.0.0.1:6379/x'],
    ['a non-Redis scheme', 'http://127.0.0.1:6379/3'],
    ['a socket path option', 'redis://127.0.0.1:6379/3?path=/tmp/other.sock'],
    ['any query option', 'redis://127.0.0.1:6379/3?db=0'],
    ['an unparseable URL', 'not a url'],
    ['a malformed password encoding', 'redis://:%FF@127.0.0.1:6379/3'],
    ['a malformed username encoding', 'redis://%E0%A4%A@127.0.0.1:6379/3'],
  ])('refuses %s', (_label, url) => {
    expect(() => scratchRedisEndpoint(url)).toThrow(
      /loopback Redis on a numbered database other than 0/,
    );
  });

  it('does not echo the URL, which may carry a password', () => {
    let message = '';
    try {
      scratchRedisEndpoint('redis://:hunter2@cache.internal:6379/3');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/loopback Redis/);
    expect(message).not.toContain('hunter2');
  });
});
