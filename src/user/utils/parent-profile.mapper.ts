import { Subscription } from '@prisma/client';
import { SUBSCRIPTION_STATUS } from '../../subscription/subscription.constants';

export function mapParentProfile(user: any) {
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
    subscriptionStatus: getSubscriptionStatus(user.subscriptions),
  };
}

function getSubscriptionStatus(subscriptions: Subscription[]): string {
  if (!subscriptions || subscriptions.length === 0)
    return SUBSCRIPTION_STATUS.FREE;
  const activeSub = subscriptions.find(
    (sub) => sub.status === SUBSCRIPTION_STATUS.ACTIVE,
  );
  return activeSub ? SUBSCRIPTION_STATUS.ACTIVE : SUBSCRIPTION_STATUS.FREE;
}
