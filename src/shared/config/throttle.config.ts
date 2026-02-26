import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '../constants/throttle.constants';

export interface ThrottlerConfig {
  name: string;
  ttl: number;
  limit: number;
}

export const throttleConfig: ThrottlerModuleOptions & {
  throttlers: ThrottlerConfig[];
} = {
  throttlers: [
    {
      name: 'short',
      ttl: THROTTLE_LIMITS.SHORT.TTL,
      limit: THROTTLE_LIMITS.SHORT.LIMIT,
    },
    {
      name: 'medium',
      ttl: THROTTLE_LIMITS.MEDIUM.TTL,
      limit: THROTTLE_LIMITS.MEDIUM.LIMIT,
    },
    {
      name: 'long',
      ttl: THROTTLE_LIMITS.LONG.TTL,
      limit: THROTTLE_LIMITS.LONG.LIMIT,
    },
  ],
};
