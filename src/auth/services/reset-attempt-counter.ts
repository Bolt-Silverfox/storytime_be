import type { Redis } from 'ioredis';
import { withHealthTimeout } from '@/health/indicators/health-timeout';

export const READ_MISSES = `
local misses = redis.call('GET', KEYS[1])
if misses and redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return misses
`;

export const COUNT_MISS = `
local misses = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return misses
`;

export class RedisNotReadyError extends Error {
  constructor() {
    super('Redis client is not ready');
    this.name = 'RedisNotReadyError';
  }
}

export class ResetAttemptCounter {
  constructor(
    private readonly client: Redis,
    private readonly windowMs: number,
    private readonly timeoutMs: number,
  ) {}

  async misses(key: string): Promise<number> {
    this.assertReady();
    const stored = await withHealthTimeout(
      this.client.eval(READ_MISSES, 1, key, String(this.windowMs)),
      this.timeoutMs,
    );
    return stored === null ? 0 : this.toCount(stored);
  }

  async chargeMiss(key: string): Promise<number> {
    this.assertReady();
    return await this.recordMiss(key);
  }

  async recordMiss(key: string): Promise<number> {
    const misses = await withHealthTimeout(
      this.client.eval(COUNT_MISS, 1, key, String(this.windowMs)),
      this.timeoutMs,
    );
    return this.toCount(misses);
  }

  async clear(key: string): Promise<void> {
    this.assertReady();
    await withHealthTimeout(this.client.del(key), this.timeoutMs);
  }

  private assertReady() {
    if (this.client.status !== 'ready') throw new RedisNotReadyError();
  }

  private toCount(value: unknown): number {
    const count =
      typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error('Reset attempt counter unreadable');
    }
    return count;
  }
}
