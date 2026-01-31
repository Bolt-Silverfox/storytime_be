export interface PlanDefinition {
    amount: number;
    days: number;
    display: string;
}

export const PAYMENT_CONSTANTS = {
    CURRENCY: 'USD',
    MILLISECONDS_PER_DAY: 24 * 60 * 60 * 1000,
    PLANS: {
        free: { amount: 0, days: 365 * 100, display: 'Free' },
        weekly: { amount: 1.5, days: 7, display: 'Weekly' },
        monthly: { amount: 4.99, days: 30, display: 'Monthly' },
        yearly: { amount: 47.99, days: 365, display: 'Yearly' },
    } as Record<string, PlanDefinition>, // Use concrete type
    TRANSACTION_STATUS: {
        PENDING: 'pending',
        SUCCESS: 'success',
        FAILED: 'failed',
    },
    PAYMENT_METHOD_TYPES: {
        CARD: 'card',
        PAYPAL: 'paypal',
    },
} as const;

export enum IapPlatform {
    ANDROID = 'android',
    IOS = 'ios',
}
