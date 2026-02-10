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
    REFRESH: {
      TTL: 60000, // 1 minute
      LIMIT: 10, // Allow reasonable token refreshes
    },
    PASSWORD_RESET_REQUEST: {
      TTL: 3600000, // 1 hour
      LIMIT: 3, // Prevent email bombing
    },
    PASSWORD_RESET: {
      TTL: 3600000, // 1 hour
      LIMIT: 5, // Allow a few attempts with different tokens
    },
    EMAIL_VERIFICATION: {
      TTL: 300000, // 5 minutes
      LIMIT: 3, // Prevent verification email spam
    },
    OAUTH: {
      TTL: 60000, // 1 minute
      LIMIT: 10, // Social login attempts
    },
  },
  PAYMENT: {
    VERIFY_PURCHASE: {
      TTL: 60000, // 1 minute
      LIMIT: 5, // Purchase verification
    },
    CANCEL: {
      TTL: 3600000, // 1 hour
      LIMIT: 3, // Subscription cancellation
    },
    STATUS: {
      TTL: 10000, // 10 seconds
      LIMIT: 10, // Status checks
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
  PREMIUM_MULTIPLIER: 5,
};
