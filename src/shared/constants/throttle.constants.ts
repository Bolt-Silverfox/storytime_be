
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
    PAYMENT: {
        VERIFY: {
            TTL: 60000, // 1 minute
            LIMIT: 10, // Max 10 verification attempts per minute
        },
        CANCEL: {
            TTL: 60000, // 1 minute
            LIMIT: 3, // Max 3 cancel attempts per minute
        },
        STATUS: {
            TTL: 10000, // 10 seconds
            LIMIT: 20, // Max 20 status checks per 10 seconds
        },
    },
    SUBSCRIPTION: {
        SUBSCRIBE: {
            TTL: 60000, // 1 minute
            LIMIT: 5, // Max 5 subscribe attempts per minute
        },
        CANCEL: {
            TTL: 60000, // 1 minute
            LIMIT: 3, // Max 3 cancel attempts per minute
        },
        HISTORY: {
            TTL: 10000, // 10 seconds
            LIMIT: 10, // Max 10 history requests per 10 seconds
        },
        STATUS: {
            TTL: 10000, // 10 seconds
            LIMIT: 20, // Max 20 status checks per 10 seconds
        },
    },
    PREMIUM_MULTIPLIER: 5,
};
