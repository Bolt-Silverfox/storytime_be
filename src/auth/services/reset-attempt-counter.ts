import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { withHealthTimeout } from '@/health/indicators/health-timeout';

export const CHARGE_WITHIN_LIMIT = `
redis.call('HSETNX', KEYS[1], ARGV[3], '1')
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local charged = redis.call('HLEN', KEYS[1]) - 1
if charged >= tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], ARGV[4], '1')
return charged + 1
`;

const WINDOW_FIELD = 'window';

export class RedisNotReadyError extends Error {
  constructor() {
    super('Redis client is not ready');
    this.name = 'RedisNotReadyError';
  }
}

export interface ResetCharge {
  reservation: string;
  withinLimit: boolean;
  count: number;
}

export class ResetAttemptCounter {
  constructor(
    private readonly client: Redis,
    private readonly windowMs: number,
    private readonly max: number,
    private readonly timeoutMs: number,
  ) {}

  async reserve(key: string): Promise<ResetCharge> {
    if (this.client.status !== 'ready') throw new RedisNotReadyError();
    const reservation = randomUUID();
    try {
      return await this.chargeWith(key, reservation);
    } catch (error) {
      this.client.hdel(key, reservation).catch(() => undefined);
      throw error;
    }
  }

  record(key: string): Promise<ResetCharge> {
    return this.chargeWith(key, randomUUID());
  }

  private async chargeWith(
    key: string,
    reservation: string,
  ): Promise<ResetCharge> {
    const count = await withHealthTimeout(
      this.client.eval(
        CHARGE_WITHIN_LIMIT,
        1,
        key,
        String(this.windowMs),
        String(this.max),
        WINDOW_FIELD,
        reservation,
      ),
      this.timeoutMs,
    );
    if (!Number.isInteger(count)) {
      throw new Error('Reset attempt counter not recorded');
    }
    return { reservation, withinLimit: count !== 0, count: count as number };
  }

  async refund(key: string, reservation: string): Promise<void> {
    await withHealthTimeout(this.client.hdel(key, reservation), this.timeoutMs);
  }

  async clear(key: string): Promise<void> {
    await withHealthTimeout(this.client.del(key), this.timeoutMs);
  }
}
