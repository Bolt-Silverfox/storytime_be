import { render } from '@react-email/render';
import { EmailVerificationTemplate } from './templates/email-verification';
import { PasswordResetTemplate } from './templates/password-reset';
import { PasswordResetAlertTemplate } from './templates/password-reset-alert';
import { PasswordChangedTemplate } from './templates/password-changed';
import { PinResetTemplate } from './templates/pin-reset';
import { QuotaExhaustedTemplate } from './templates/quota-exhausted';
import { SubscriptionWelcomeTemplate } from './templates/subscription-welcome';
import { PaymentFailedTemplate } from './templates/payment-failed';
import { NotificationCategory } from '@prisma/client';

export type Notifications =
  | 'EmailVerification'
  | 'PasswordReset'
  | 'PasswordResetAlert'
  | 'PasswordChanged'
  | 'PinReset'
  | 'NewStory'
  | 'AchievementUnlocked'
  | 'QuotaExhausted'
  | 'SubscriptionWelcome'
  | 'PaymentSuccess'
  | 'PaymentFailed'
  | 'SubscriptionReminder'
  | 'WeMissYou'
  | 'IncompleteStoryReminder'
  | 'DailyListeningReminder';

export type Medium = 'email' | 'sms' | 'push' | 'in_app';

export const NotificationRegistry: Record<
  Notifications,
  {
    medium: Medium;
    category: NotificationCategory;
    subject: string;
    validate: (data: Record<string, unknown>) => string | null;
    getTemplate: (data: Record<string, unknown>) => Promise<string>;
  }
> = {
  EmailVerification: {
    medium: 'email',
    category: NotificationCategory.EMAIL_VERIFICATION,
    subject: 'Email Verification',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.token) return 'Token is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        EmailVerificationTemplate({
          token: data.token as string,
          email: data.email as string,
        }),
      );
      return emailHtml;
    },
  },
  PasswordReset: {
    medium: 'email',
    category: NotificationCategory.PASSWORD_RESET,
    subject: 'Password Reset',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.resetToken) return 'Reset token is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        PasswordResetTemplate({
          resetToken: data.resetToken as string,
          email: data.email as string,
        }),
      );
      return emailHtml;
    },
  },
  PasswordResetAlert: {
    medium: 'email',
    category: NotificationCategory.PASSWORD_RESET_ALERT,
    subject: 'Password Reset Alert',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.ipAddress) return 'IP address is required';
      if (!data.userAgent) return 'User agent is required';
      if (!data.timestamp) return 'Timestamp is required';
      if (!data.userName) return 'User name is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        PasswordResetAlertTemplate({
          email: data.email as string,
          ipAddress: data.ipAddress as string,
          userAgent: data.userAgent as string,
          timestamp: data.timestamp as string,
          userName: data.userName as string,
        }),
      );
      return emailHtml;
    },
  },
  PasswordChanged: {
    medium: 'email',
    category: NotificationCategory.PASSWORD_CHANGED,
    subject: 'Password Changed Successfully',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.userName) return 'User name is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        PasswordChangedTemplate({
          email: data.email as string,
          userName: data.userName as string,
        }),
      );
      return emailHtml;
    },
  },
  PinReset: {
    medium: 'email',
    category: NotificationCategory.PIN_RESET,
    subject: 'Your PIN Reset Code',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.otp) return 'OTP is required';
      if (!data.userName) return 'User name is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        PinResetTemplate({
          email: data.email as string,
          otp: data.otp as string,
          userName: data.userName as string,
        }),
      );
      return emailHtml;
    },
  },
  NewStory: {
    medium: 'in_app',
    category: NotificationCategory.NEW_STORY,
    subject: 'New Story Available!',
    validate: (data) => {
      if (!data.storyTitle) return 'Story title is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `A new story "${String(data.storyTitle)}" is now available for you to read!`,
      );
    },
  },
  AchievementUnlocked: {
    medium: 'in_app',
    category: NotificationCategory.ACHIEVEMENT_UNLOCKED,
    subject: 'Achievement Unlocked!',
    validate: (data) => {
      if (!data.achievementName) return 'Achievement name is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `Congratulations! You've unlocked the "${String(data.achievementName)}" achievement.`,
      );
    },
  },
  QuotaExhausted: {
    medium: 'email',
    category: NotificationCategory.SUBSCRIPTION_ALERT,
    subject: "You've Reached Your Free Limit - Upgrade to Premium",
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.userName) return 'User name is required';
      if (!data.quotaType) return 'Quota type is required';
      if (typeof data.used !== 'number') return 'Used count is required';
      if (typeof data.limit !== 'number') return 'Limit is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        QuotaExhaustedTemplate({
          email: data.email as string,
          userName: data.userName as string,
          quotaType: data.quotaType as 'story' | 'voice',
          used: data.used as number,
          limit: data.limit as number,
        }),
      );
      return emailHtml;
    },
  },
  SubscriptionWelcome: {
    medium: 'email',
    category: NotificationCategory.PAYMENT_SUCCESS,
    subject: 'Welcome to StoryTime Premium!',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.userName) return 'User name is required';
      if (!data.planName) return 'Plan name is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        SubscriptionWelcomeTemplate({
          email: data.email as string,
          userName: data.userName as string,
          planName: data.planName as string,
        }),
      );
      return emailHtml;
    },
  },
  PaymentSuccess: {
    medium: 'in_app',
    category: NotificationCategory.PAYMENT_SUCCESS,
    subject: 'Payment Successful',
    validate: (data) => {
      if (data.amount === undefined || data.amount === null)
        return 'Amount is required';
      if (!data.currency) return 'Currency is required';
      if (!data.plan) return 'Plan is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `Your payment of ${data.currency} ${data.amount} for the ${data.plan} plan was successful.`,
      );
    },
  },
  PaymentFailed: {
    medium: 'email',
    category: NotificationCategory.PAYMENT_FAILED,
    subject: 'Payment Could Not Be Processed - StoryTime',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.userName) return 'User name is required';
      return null;
    },
    getTemplate: async (data) => {
      const emailHtml = render(
        PaymentFailedTemplate({
          email: data.email as string,
          userName: data.userName as string,
          errorMessage: data.errorMessage as string | undefined,
        }),
      );
      return emailHtml;
    },
  },
  SubscriptionReminder: {
    medium: 'in_app',
    category: NotificationCategory.SUBSCRIPTION_REMINDER,
    subject: 'Subscription Reminder',
    validate: (data) => {
      if (!data.plan) return 'Plan is required';
      if (data.daysLeft === undefined || data.daysLeft === null)
        return 'Days left is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `Your ${data.plan} plan renews in ${data.daysLeft} day(s).`,
      );
    },
  },
  WeMissYou: {
    medium: 'in_app',
    category: NotificationCategory.WE_MISS_YOU,
    subject: 'We Miss You!',
    validate: (data) => {
      if (!data.name) return 'Name is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `We miss you, ${data.name}! Come back for a new story.`,
      );
    },
  },
  IncompleteStoryReminder: {
    medium: 'in_app',
    category: NotificationCategory.INCOMPLETE_STORY_REMINDER,
    subject: 'Finish Your Story',
    validate: (data) => {
      if (!data.storyTitle) return 'Story title is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(
        `You still have "${data.storyTitle}" waiting to be finished!`,
      );
    },
  },
  DailyListeningReminder: {
    medium: 'in_app',
    category: NotificationCategory.DAILY_LISTENING_REMINDER,
    subject: 'Daily Listening Reminder',
    validate: (data) => {
      if (!data.name) return 'Name is required';
      return null;
    },
    getTemplate: (data) => {
      return Promise.resolve(`Hi ${data.name}, ready for today's story time?`);
    },
  },
};
