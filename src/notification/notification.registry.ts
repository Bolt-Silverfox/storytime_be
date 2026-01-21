import { render } from '@react-email/render';
import { EmailVerificationTemplate } from './templates/email-verification';
import { PasswordResetTemplate } from './templates/password-reset';
import { PasswordResetAlertTemplate } from './templates/password-reset-alert';
import { PasswordChangedTemplate } from './templates/password-changed';
import { PinResetTemplate } from './templates/pin-reset';
import { NotificationCategory } from '@prisma/client';

export type Notifications =
  | 'EmailVerification'
  | 'PasswordReset'
  | 'PasswordResetAlert'
  | 'PasswordChanged'
  | 'PinReset'
  | 'NewStory'
  | 'AchievementUnlocked';

export type Medium = 'email' | 'sms' | 'push' | 'in_app';

export const NotificationRegistry: Record<
  Notifications,
  {
    medium: Medium;
    category: NotificationCategory;
    subject: string;
    validate: (data: Record<string, any>) => string | null;
    getTemplate: (data: Record<string, any>) => Promise<string>;
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
    getTemplate: async (data) => {
      return `A new story "${data.storyTitle}" is now available for you to read!`;
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
    getTemplate: async (data) => {
      return `Congratulations! You've unlocked the "${data.achievementName}" achievement.`;
    },
  },
};
