export const THROTTLE_LIMITS = {
  SHORT: {
    TTL: 1000, // 1 second
    LIMIT: 10,
  },
  MEDIUM: {
    TTL: 10000, // 10 seconds
    LIMIT: 50,
  },
  LONG: {
    TTL: 60000, // 1 minute
    LIMIT: 100,
  },
  AUTH: {
    LOGIN: {
      TTL: 60000, // 1 minute
      LIMIT: 3,
    },
    REGISTER: {
      TTL: 3600000, // 1 hour
      LIMIT: 3,
    },
  },
  GENERATION: {
    FREE: {
      TTL: 3600000, // 1 hour
      LIMIT: 10,
    },
    PREMIUM: {
      TTL: 3600000, // 1 hour
      LIMIT: 50,
    },
  },
  NOTIFICATION_PREFERENCES: {
    TTL: 60000, // 1 minute
    LIMIT: 5,
  },
  PREMIUM_MULTIPLIER: 5,
};
