export const SUBSCRIPTION_STATUS = {
    ACTIVE: 'active',
    CANCELLED: 'cancelled',
    FREE: 'free',
} as const;

export type SubscriptionStatusType = typeof SUBSCRIPTION_STATUS[keyof typeof SUBSCRIPTION_STATUS];
