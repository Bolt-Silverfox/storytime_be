import { render } from '@react-email/render';
import { EmailVerificationTemplate } from './templates/email-verification';
import { PasswordResetTemplate } from './templates/password-reset';
import { PasswordResetAlertTemplate } from './templates/password-reset-alert';
import { PasswordChangedTemplate } from './templates/password-changed';
import { PinResetTemplate } from './templates/pin-reset';

export type Notifications =
  | 'EmailVerification'
  | 'PasswordReset'
  | 'PasswordResetAlert'
  | 'PasswordChanged'
  | 'PinReset';

export type Medium = 'email' | 'sms';

export const NotificationRegistry: Record<
  Notifications,
  {
    medium: Medium;
    subject: string;
    validate: (data: Record<string, any>) => string | null;
    getTemplate: (data: Record<string, any>) => Promise<string>;
  }
> = {
  EmailVerification: {
    medium: 'email',
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
};
