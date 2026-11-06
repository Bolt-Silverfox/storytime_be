import { Prisma } from '@prisma/client';

export const DISPOSABLE_USER_RELATIONS = [
  'auth',
  'Token',
  'activityLogs',
  'userIps',
  'notifications',
  'notificationPreferences',
  'deviceTokens',
  'avatar',
] as const;

export function staleUnverifiedWhere(cutoff: Date): Prisma.UserWhereInput {
  return {
    isEmailVerified: false,
    isSuspended: false,
    isDeleted: false,
    role: 'parent',
    createdAt: { lt: cutoff },
    googleId: null,
    appleId: null,
    premiumAccessUntil: null,
    preferredVoice: null,
    kids: { none: {} },
    badges: { none: {} },
    parentFavorites: { none: {} },
    userStoryProgress: { none: {} },
    questionAnswers: { none: {} },
    voices: { none: {} },
    Reward: { none: {} },
    preferredCategories: { none: {} },
    supportTickets: { none: {} },
    paymentMethods: { none: {} },
    paymentTransactions: { none: {} },
    parentRecommendations: { none: {} },
    restrictedStories: { none: {} },
    learningExpectations: { none: {} },
    couponRedemptions: { none: {} },
    subscription: null,
    AND: [
      {
        OR: [
          { profile: null },
          {
            profile: {
              is: {
                language: null,
                languageCode: null,
                maxScreenTimeMins: null,
              },
            },
          },
        ],
      },
      {
        OR: [
          { usage: null },
          {
            usage: {
              is: {
                uniqueStoriesRead: 0,
                elevenLabsCount: 0,
                geminiStoryCount: 0,
                geminiImageCount: 0,
              },
            },
          },
        ],
      },
    ],
  };
}
