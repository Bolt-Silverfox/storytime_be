const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export type ScratchRedisEndpoint = {
  host: string;
  port: number;
  db: number;
  username: string | undefined;
  password: string | undefined;
};

const refuse = (): never => {
  throw new Error(
    'Scratch Redis specs need a loopback Redis on a numbered database other than 0',
  );
};

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value) || undefined;
  } catch {
    return refuse();
  }
};

export function scratchRedisEndpoint(url: string): ScratchRedisEndpoint {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  const host = parsed?.hostname.replace(/^\[(.*)\]$/, '$1') ?? '';
  const database = parsed?.pathname.slice(1) ?? '';
  const isScratch =
    parsed !== undefined &&
    parsed.protocol === 'redis:' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    LOOPBACK_HOSTS.has(host) &&
    /^[1-9]\d*$/.test(database);
  if (!parsed || !isScratch) return refuse();
  return {
    host,
    port: Number(parsed.port || 6379),
    db: Number(database),
    username: decoded(parsed.username),
    password: decoded(parsed.password),
  };
}
