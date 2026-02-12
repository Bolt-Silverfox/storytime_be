import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import {
  AppEvents,
  UserRegisteredEvent,
  UserEmailVerifiedEvent,
  UserPasswordChangedEvent,
} from '@/shared/events';

/**
 * Event listener for auth-related events that trigger notifications.
 * This decouples AuthModule from NotificationModule.
 */
@Injectable()
export class AuthEventListener {
  private readonly logger = new Logger(AuthEventListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Send welcome email when user registers.
   * Triggered by: AuthService.register()
   */
  @OnEvent(AppEvents.USER_REGISTERED)
  async handleUserRegistered(payload: UserRegisteredEvent) {
    this.logger.log(
      `Handling user.registered event for user ${payload.userId}`,
    );

    // Send email verification notification
    // Note: This should include the verification token in the actual implementation
    // For now, we'll just log it since we need to refactor how tokens are passed
    this.logger.log(`Would send email verification to ${payload.email}`);
  }

  /**
   * Log when user verifies their email.
   * Triggered by: AuthService.verifyEmail()
   *
   * Note: Welcome notifications can be added to NotificationRegistry if needed
   */
  @OnEvent(AppEvents.USER_EMAIL_VERIFIED)
  async handleEmailVerified(payload: UserEmailVerifiedEvent) {
    this.logger.log(`User ${payload.userId} verified email: ${payload.email}`);

    // Future: Send welcome notification if Welcome template is added to registry
  }

  /**
   * Send notification when user changes their password.
   * Triggered by: PasswordService.changePassword()
   */
  @OnEvent(AppEvents.USER_PASSWORD_CHANGED)
  async handlePasswordChanged(payload: UserPasswordChangedEvent) {
    this.logger.log(
      `Handling user.password_changed event for user ${payload.userId}`,
    );

    // Note: We need user email from the event payload
    // This will be added when we refactor the auth service to emit events
    this.logger.log(
      `Would send password changed confirmation to user ${payload.userId}`,
    );
  }
}
