import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';

/**
 * Event listener for password-related events that require special handling.
 * Separated from AuthEventListener because password events often need tokens/additional data.
 */
@Injectable()
export class PasswordEventListener {
  private readonly logger = new Logger(PasswordEventListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Send password reset email with token.
   * This is a custom event emitted by PasswordService with the reset token.
   */
  @OnEvent('password.reset_requested')
  async handlePasswordResetRequested(payload: {
    userId: string;
    email: string;
    resetToken: string;
  }) {
    this.logger.log(`Sending password reset email to ${payload.email}`);

    await this.notificationService.sendNotification('PasswordReset', {
      email: payload.email,
      resetToken: payload.resetToken,
    });
  }

  /**
   * Send email verification with token.
   * This is a custom event emitted by AuthService with the verification token.
   */
  @OnEvent('email.verification_requested')
  async handleEmailVerificationRequested(payload: {
    userId: string;
    email: string;
    token: string;
  }) {
    this.logger.log(`Sending email verification to ${payload.email}`);

    const resp = await this.notificationService.sendNotification(
      'EmailVerification',
      {
        email: payload.email,
        token: payload.token,
      },
    );

    if (!resp.success) {
      this.logger.error(`Failed to send email verification: ${resp.error}`);
    }
  }

  /**
   * Send password changed confirmation with user details.
   */
  @OnEvent('password.changed')
  async handlePasswordChanged(payload: {
    userId: string;
    email: string;
    userName: string | null;
  }) {
    this.logger.log(
      `Sending password changed confirmation to ${payload.email}`,
    );

    await this.notificationService.sendNotification('PasswordChanged', {
      email: payload.email,
      userName: payload.userName,
    });
  }
}
