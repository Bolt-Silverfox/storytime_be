import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppEvents, UserRegisteredEvent } from '@/shared/events';
import { NotificationPreferenceService } from '../services/notification-preference.service';

/**
 * Event listener for notification preference-related triggers.
 * Ensures all new users get default notification settings upon registration.
 */
@Injectable()
export class NotificationPreferenceEventListener {
    private readonly logger = new Logger(NotificationPreferenceEventListener.name);

    constructor(
        private readonly notificationPreferenceService: NotificationPreferenceService,
    ) { }

    /**
     * Seed default notification preferences for a new user.
     * Triggered by: OnboardingService.register() and OAuthService login.
     */
    @OnEvent(AppEvents.USER_REGISTERED)
    async handleUserRegistered(payload: UserRegisteredEvent) {
        this.logger.log(
            `feat: seeding default notification preferences for user ${payload.userId}`,
        );
        try {
            await this.notificationPreferenceService.seedDefaultPreferences(
                payload.userId,
            );
        } catch (error) {
            this.logger.error(
                `Failed to seed notification preferences for user ${payload.userId}: ${error.message}`,
            );
        }
    }
}
