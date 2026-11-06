import { Injectable } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

const INCR_WITH_EXPIRY = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

@Injectable()
export class PasswordlessThrottleService {
  constructor(private readonly redis: RedisService) {}

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
