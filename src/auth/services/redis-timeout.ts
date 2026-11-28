import { PASSWORDLESS_REDIS_TIMEOUT_MS } from './passwordless.constants';

export const withRedisTimeout = <T>(command: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Passwordless Redis call timed out')),
      PASSWORDLESS_REDIS_TIMEOUT_MS,
    );
  });
  return Promise.race([command, timeout]).finally(() => clearTimeout(timer));
};
