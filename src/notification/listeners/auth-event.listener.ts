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
   * Observe user registration.
   * Triggered by: OnboardingService.register().
   *
   * NOTE: the verification email is sent by OnboardingService.register itself
   * (via EmailVerificationService.sendEmailVerification, which owns the token),
   * not here — this listener only needs the token to build the email and does
   * not have it. Kept for future welcome-notification wiring / observability.
   */
  @OnEvent(AppEvents.USER_REGISTERED)
  handleUserRegistered(payload: UserRegisteredEvent) {
    this.logger.log(`user.registered: ${payload.userId}`);
  }

  /**
   * Log when user verifies their email.
   * Triggered by: AuthService.verifyEmail()
   *
   * Note: Welcome notifications can be added to NotificationRegistry if needed
   */
  @OnEvent(AppEvents.USER_EMAIL_VERIFIED)
  handleEmailVerified(payload: UserEmailVerifiedEvent) {
    this.logger.log(`User ${payload.userId} verified email: ${payload.email}`);

    // Future: Send welcome notification if Welcome template is added to registry
  }

  /**
   * Send notification when user changes their password.
   * Triggered by: PasswordService.changePassword()
   */
  @OnEvent(AppEvents.USER_PASSWORD_CHANGED)
  handlePasswordChanged(payload: UserPasswordChangedEvent) {
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
