import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs/promises';

export type Notifications = 'EmailVerification' | 'PasswordReset';
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
      const templatePath = path.join(
        __dirname,
        'templates',
        'email-verification.ejs',
      );
      const template = await fs.readFile(templatePath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return ejs.render(template, {
        token: data.token as string,
        email: data?.email as string,
      });
    },
  },
  PasswordReset: {
    medium: 'email',
    subject: 'Password Reset',
    validate: (data) => {
      if (!data.email) return 'Email is required';
      if (!data.resetLink) return 'Reset link is required';
      return null;
    },
    getTemplate: async (data) => {
      const templatePath = path.join(
        __dirname,
        'templates',
        'password-reset.ejs',
      );
      const template = await fs.readFile(templatePath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return ejs.render(template, {
        resetLink: data?.resetLink as string,
        email: data?.email as string,
      });
    },
  },
};
