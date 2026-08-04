import { Subscription } from '@prisma/client';
import { SUBSCRIPTION_STATUS } from '../../subscription/subscription.constants';

export interface UserWithRelations {
  id: string;
  email: string;
  title?: string | null;
  name?: string | null;
  avatar?: {
    id: string;
    url: string;
    isSystemAvatar?: boolean;
  } | null;
  profile?: {
    explicitContent?: boolean;
    maxScreenTimeMins?: number | null;
    language?: string | null;
    country?: string;
  } | null;
  role: string;
  kids?: { id: string }[];
  pinHash?: string | null;
  biometricsEnabled?: boolean;
  hasRatedApp?: boolean;
  rateAppDismissedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subscription?: Subscription | null;
  premiumAccessUntil?: Date | null;
}

export function mapParentProfile(user: UserWithRelations | null) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    title: user.title ?? null,
    name: user.name ?? null,
    avatar: user.avatar
      ? {
          id: user.avatar.id,
          url: user.avatar.url,
          isSystemAvatar: !!user.avatar.isSystemAvatar,
        }
      : null,
    profile: user.profile
      ? {
          explicitContent: user.profile.explicitContent,
          maxScreenTimeMins: user.profile.maxScreenTimeMins,
          language: user.profile.language,
          country: user.profile.country,
        }
      : null,
    role: user.role,
    numberOfKids: Array.isArray(user.kids) ? user.kids.length : 0,
    pinSet: !!user.pinHash,
    biometricsEnabled: !!user.biometricsEnabled,
    hasRatedApp: !!user.hasRatedApp,
    rateAppDismissedAt: user.rateAppDismissedAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    subscriptionStatus: getSubscriptionStatus(
      user.subscription,
      user.premiumAccessUntil,
    ),
  };
}

function getSubscriptionStatus(
  subscription?: Subscription | null,
  premiumAccessUntil?: Date | null,
): string {
  // Coupon-granted premium access
  if (premiumAccessUntil && premiumAccessUntil > new Date()) {
    return SUBSCRIPTION_STATUS.ACTIVE;
  }
  if (!subscription) return SUBSCRIPTION_STATUS.FREE;
  return subscription.status === SUBSCRIPTION_STATUS.ACTIVE
    ? SUBSCRIPTION_STATUS.ACTIVE
    : SUBSCRIPTION_STATUS.FREE;
}
