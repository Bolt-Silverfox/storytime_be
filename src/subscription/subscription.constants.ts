export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  FREE: 'free',
} as const;

export type SubscriptionStatusType =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

/** Plan definitions: display name, amount, and duration in days */
export const PLANS: Record<
  string,
  { display: string; amount: number; days: number }
> = {
  free: { display: 'Free', amount: 0, days: 365 * 100 },
  weekly: { display: 'Weekly', amount: 1.5, days: 7 },
  monthly: { display: 'Monthly', amount: 4.99, days: 30 },
  yearly: { display: 'Yearly', amount: 47.99, days: 365 },
};

/** Product ID to plan mapping for IAP */
export const PRODUCT_ID_TO_PLAN: Record<string, string> = {
  'com.storytime.weekly': 'weekly',
  'com.storytime.monthly': 'monthly',
  'com.storytime.yearly': 'yearly',
  weekly_subscription: 'weekly',
  monthly_subscription: 'monthly',
  yearly_subscription: 'yearly',
  '1_month_subscription': 'monthly',
  '1_year_subscription': 'yearly',
};
