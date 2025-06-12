import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { NotificationRegistry, Notifications } from './notification.registry';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  async sendNotification(
    type: Notifications,
    data: Record<string, any>,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const notification = NotificationRegistry[type];
      if (!notification) {
        throw new Error(`invalid notification: ${type}`);
      }

      const err = notification.validate(data);
      if (err) {
        throw new Error(`${type} failed: ${err}`);
      }

      const template = await notification.getTemplate(data);

      if (notification.medium != 'email') {
        throw new Error(`medium: ${notification.medium} not implemented`);
      }

      const resp = await this.sendEmail(
        data?.email as string,
        notification.subject,
        template,
      );
      return resp;
    } catch (error) {
      return {
        success: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error: error?.message,
      };
    }
  }

  async sendEmail(
    email: string,
    subject: string,
    htmlContent: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const payload = {
        sender: {
          email: process.env.DEFAULT_SENDER_EMAIL,
          name: process.env.DEFAULT_SENDER_NAME,
        },
        to: [{ email }],
        subject: subject,
        htmlContent: htmlContent,
      };

      const response = await axios.post<{ messageId?: string }>(
        process.env.BREVO_API_URL ?? '',
        payload,
        {
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      console.log('email sent successfully:', response.data);
      return {
        success: true,
        messageId: response.data.messageId || 'Message sent',
      };
    } catch (error: unknown) {
      let errorMessage = 'Failed to send email';
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        errorMessage = error.response.data.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
