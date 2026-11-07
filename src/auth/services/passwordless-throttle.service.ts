import { Injectable } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

const INCR_WITH_EXPIRY = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

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
    await this.redis.client.eval(DECR_CLAMPED, 1, key, String(windowMs));
  }

  async mark(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.client.set(key, '1', 'EX', ttlSeconds);
  }

  async peek(key: string): Promise<number> {
    return Number((await this.redis.client.get(key)) ?? 0);
  }

  async hit(key: string, windowMs: number): Promise<number> {
    const count = await this.redis.client.eval(
      INCR_WITH_EXPIRY,
      1,
      key,
      String(windowMs),
    );
    return Number(count);
  }
}
