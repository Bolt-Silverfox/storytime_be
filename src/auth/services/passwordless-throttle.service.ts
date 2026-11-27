import { Injectable } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';
import { withRedisTimeout as withTimeout } from './redis-timeout';

export const INCR_WITH_EXPIRY = `
local n = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export const ADMIT_WITHIN_LIMITS = `
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i * 2]) then
    return 0
  end
end
local first = 0
for i = 1, #KEYS do
  local n = redis.call('INCR', KEYS[i])
  if redis.call('PTTL', KEYS[i]) < 0 then redis.call('PEXPIRE', KEYS[i], ARGV[i * 2 - 1]) end
  if i == 1 then first = n end
end
return first
`;

export interface ThrottleBudget {
  key: string;
  windowMs: number;
  max: number;
}

export const DECR_CLAMPED = `
local n = redis.call('DECR', KEYS[1])
if n < 0 then
  redis.call('SET', KEYS[1], '0', 'PX', ARGV[1])
  return 0
end
return n
`;

@Injectable()
export class PasswordlessThrottleService {
  constructor(private readonly redis: RedisService) {}

  async release(key: string, windowMs: number): Promise<void> {
    await withTimeout(
      this.redis.client.eval(DECR_CLAMPED, 1, key, String(windowMs)),
    );
  }

  async mark(key: string, ttlSeconds: number): Promise<void> {
    await withTimeout(this.redis.client.set(key, '1', 'EX', ttlSeconds));
  }

  async peek(key: string): Promise<number> {
    return Number((await withTimeout(this.redis.client.get(key))) ?? 0);
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const count = await withTimeout(
      this.redis.client.eval(INCR_WITH_EXPIRY, 1, key, String(windowMs)),
    );
    return Number(count);
  }

  async admit(budgets: readonly ThrottleBudget[]): Promise<number> {
    const count = await withTimeout(
      this.redis.client.eval(
        ADMIT_WITHIN_LIMITS,
        budgets.length,
        ...budgets.map((b) => b.key),
        ...budgets.flatMap((b) => [String(b.windowMs), String(b.max)]),
      ),
    );
    return Number(count);
  }
}
