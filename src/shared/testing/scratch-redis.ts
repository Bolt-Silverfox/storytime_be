const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function assertScratchRedisUrl(url: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  const database = parsed?.pathname.slice(1) ?? '';
  const isScratch =
    parsed !== undefined &&
    parsed.protocol === 'redis:' &&
    LOOPBACK_HOSTS.has(parsed.hostname) &&
    /^[1-9]\d*$/.test(database);
  if (!isScratch) {
    throw new Error(
      'Scratch Redis specs need a loopback Redis on a numbered database other than 0',
    );
  }
}
