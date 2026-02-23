import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const THROTTLE_LIMITS = {
  // Authentication - strict
  AUTH_LOGIN: { ttl: 60000, limit: 10 },
  AUTH_OTP: { ttl: 60000, limit: 5 },
  AUTH_REGISTER: { ttl: 60000, limit: 5 },
  AUTH_PASSWORD_RESET: { ttl: 60000, limit: 3 },

  // Resource creation - moderate
  RESOURCE_CREATE: { ttl: 60000, limit: 20 },

  // AI operations - expensive
  AI_GENERATION: { ttl: 60000, limit: 5 },
  VOICE_SYNTHESIS: { ttl: 60000, limit: 10 },

  // Admin - higher limits
  ADMIN_READ: { ttl: 60000, limit: 200 },
  ADMIN_WRITE: { ttl: 60000, limit: 50 },

  // Device endpoints
  DEVICE_REGISTER: { ttl: 60000, limit: 10 },

  // Default
  DEFAULT: { ttl: 60000, limit: 100 },

  // Multiplier for premium users
  PREMIUM_MULTIPLIER: 5,
} as const;

export type ThrottleLimitKey = keyof typeof THROTTLE_LIMITS;

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
      ttl: 1000,
      limit: 10,
    },
    {
      name: 'medium',
      ttl: 10000,
      limit: 50,
    },
    {
      name: 'long',
      ttl: THROTTLE_LIMITS.DEFAULT.ttl,
      limit: THROTTLE_LIMITS.DEFAULT.limit,
    },
  ],
};
