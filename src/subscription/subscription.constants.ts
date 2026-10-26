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

/**
 * How a Subscription's access was obtained. Stored as a plain string column
 * (like plan/status/platform). Only 'store' is a real paying customer; every
 * other value is complimentary access.
 */
export const SUBSCRIPTION_SOURCE = {
  STORE: 'store',
  ADMIN_GRANT: 'admin_grant',
  COUPON: 'coupon',
  TRIAL: 'trial',
} as const;

export type SubscriptionSource =
  (typeof SUBSCRIPTION_SOURCE)[keyof typeof SUBSCRIPTION_SOURCE];

export const SUBSCRIPTION_SOURCES: readonly SubscriptionSource[] =
  Object.values(SUBSCRIPTION_SOURCE);

export function isSubscriptionSource(
  value: unknown,
): value is SubscriptionSource {
  return (
    typeof value === 'string' &&
    (SUBSCRIPTION_SOURCES as readonly string[]).includes(value)
  );
}

/** Complimentary = active access that was not paid for through a store. */
export function isComplimentarySource(source: string | null | undefined) {
  return source != null && source !== SUBSCRIPTION_SOURCE.STORE;
}

/** The free plan key. A free-plan row grants no paid access and earns no revenue. */
export const FREE_PLAN = 'free';

export function isFreePlan(plan: string | null | undefined) {
  return plan === FREE_PLAN;
}

/**
 * Prisma where-fragments for the paying / complimentary split. Both exclude
 * plan='free': choosing the free plan writes an active source='store' row
 * (SubscriptionService.subscribe) that is neither a paying customer nor
 * complimentary paid access.
 */
export const PAYING_SUBSCRIPTION_WHERE = {
  source: SUBSCRIPTION_SOURCE.STORE,
  plan: { not: FREE_PLAN },
} as const;
export const COMPLIMENTARY_SUBSCRIPTION_WHERE = {
  source: { not: SUBSCRIPTION_SOURCE.STORE },
  plan: { not: FREE_PLAN },
} as const;
/** Any real paid-plan row (paying or complimentary), i.e. everything except the free plan. */
export const PAID_PLAN_WHERE = { plan: { not: FREE_PLAN } } as const;

/**
 * True when a subscription row currently grants PAID access: active, not
 * expired, and not the free plan. Gating, `isPaidUser` and the paid-user
 * metrics all use this one definition.
 */
export function hasPaidAccess(
  sub:
    | {
        status?: string | null;
        plan?: string | null;
        endsAt?: Date | null;
      }
    | null
    | undefined,
  now: Date = new Date(),
) {
  if (!sub || sub.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;
  if (isFreePlan(sub.plan)) return false;
  return !sub.endsAt || sub.endsAt > now;
}

/** Prefix of the synthetic purchaseToken written by admin activation. */
export const ADMIN_ACTIVATED_TOKEN_PREFIX = 'admin-activated-';

export function isAdminActivatedToken(token: string | null | undefined) {
  return (
    typeof token === 'string' && token.startsWith(ADMIN_ACTIVATED_TOKEN_PREFIX)
  );
}

/**
 * True when the row's purchaseToken is a REAL store token that Apple/Google
 * know about. Granted rows (source != store) and admin-activated synthetic
 * tokens must never be sent to a store API.
 */
export function hasRealStoreToken(
  sub:
    | { source?: string | null; purchaseToken?: string | null }
    | null
    | undefined,
) {
  return (
    !!sub &&
    sub.source === SUBSCRIPTION_SOURCE.STORE &&
    !!sub.purchaseToken &&
    !isAdminActivatedToken(sub.purchaseToken)
  );
}

/**
 * Strip admin-internal grant details (who granted it and the free-text reason)
 * from a subscription before returning it to the end user.
 */
export function withoutAdminGrantFields<
  T extends { grantedByAdminId?: unknown; grantReason?: unknown },
>(subscription: T): Omit<T, 'grantedByAdminId' | 'grantReason'>;
export function withoutAdminGrantFields<
  T extends { grantedByAdminId?: unknown; grantReason?: unknown },
>(subscription: T | null): Omit<T, 'grantedByAdminId' | 'grantReason'> | null;
export function withoutAdminGrantFields<
  T extends { grantedByAdminId?: unknown; grantReason?: unknown },
>(subscription: T | null) {
  if (!subscription) return null;
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { grantedByAdminId, grantReason, ...rest } = subscription;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest;
}

/** Writes that turn a row back into a real store subscription (clears any grant). */
export const STORE_SOURCE_FIELDS = {
  source: SUBSCRIPTION_SOURCE.STORE,
  grantedByAdminId: null,
  grantReason: null,
} as const;
