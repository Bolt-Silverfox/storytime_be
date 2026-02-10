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
  | 'PaymentFailed';

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
};
