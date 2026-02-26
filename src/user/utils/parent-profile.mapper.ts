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
  createdAt: Date;
  updatedAt: Date;
  subscription?: Subscription | null;
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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    subscriptionStatus: getSubscriptionStatus(user.subscription),
  };
}

function getSubscriptionStatus(subscription?: Subscription | null): string {
  if (!subscription) return SUBSCRIPTION_STATUS.FREE;
  return subscription.status === SUBSCRIPTION_STATUS.ACTIVE
    ? SUBSCRIPTION_STATUS.ACTIVE
    : SUBSCRIPTION_STATUS.FREE;
}
