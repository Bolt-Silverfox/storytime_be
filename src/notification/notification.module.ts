import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './services/notification-email.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationSettingsService } from './services/notification-settings.service';
import { NotificationDeviceService } from './services/notification-device.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { InAppNotificationService } from './services/in-app-notification.service';
import { EventNotificationService } from './services/event-notification.service';
import { FcmService } from './services/fcm.service';
import { DeviceTokenService } from './services/device-token.service';
import { JobEventsService } from './services/job-events.service';
import { NotificationController } from './notification.controller';
import { InAppNotificationController } from './in-app-notification.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { DeviceController } from './device.controller';
import { SseController } from './sse.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { EMAIL_QUEUE_NAME } from './queue/email-queue.constants';
import { PUSH_QUEUE_NAME } from './queue/push-queue.constants';
import { EmailQueueService } from './queue/email-queue.service';
import { EmailProcessor } from './queue/email.processor';
import { PushQueueService } from './queue/push-queue.service';
import { PushProcessor } from './queue/push.processor';
import { AuthEventListener } from './listeners/auth-event.listener';
import { PasswordEventListener } from './listeners/password-event.listener';
import { NotificationPreferenceEventListener } from './listeners/notification-preference-event.listener';
import { HttpLatencyInterceptor } from '@/shared/interceptors/http-latency.interceptor';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  PrismaNotificationPreferenceRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
  PrismaInAppNotificationRepository,
  DEVICE_TOKEN_REPOSITORY,
  PrismaDeviceTokenRepository,
  USER_REPOSITORY,
  PrismaUserRepository,
} from './repositories';

@Module({
  imports: [
    HttpModule,
    // Register email queue
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
    }),
    // Register push notification queue
    BullModule.registerQueue({
      name: PUSH_QUEUE_NAME,
    }),
  ],
  controllers: [
    NotificationController,
    InAppNotificationController,
    UserPreferencesController,
    DeviceController,
    SseController,
  ],
  providers: [
    HttpLatencyInterceptor,
    NotificationService,
    // Focused services backing the NotificationService facade
    NotificationEmailService,
    NotificationDispatchService,
    NotificationSettingsService,
    NotificationDeviceService,
    NotificationPreferenceService,
    InAppNotificationService,
    EventNotificationService,
    FcmService,
    DeviceTokenService,
    JobEventsService,
    InAppProvider,
    EmailProvider,
    PushProvider,
    // Email queue components
    EmailQueueService,
    EmailProcessor,
    // Push queue components
    PushQueueService,
    PushProcessor,
    // Event listeners (event-driven architecture)
    AuthEventListener,
    PasswordEventListener,
    NotificationPreferenceEventListener,
    // Repository Pattern (testability, decoupling)
    {
      provide: NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: PrismaNotificationPreferenceRepository,
    },
    {
      provide: IN_APP_NOTIFICATION_REPOSITORY,
      useClass: PrismaInAppNotificationRepository,
    },
    {
      provide: DEVICE_TOKEN_REPOSITORY,
      useClass: PrismaDeviceTokenRepository,
    },
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [
    NotificationService,
    NotificationPreferenceService,
    InAppNotificationService,
    EmailQueueService,
    PushQueueService,
    FcmService,
    DeviceTokenService,
    JobEventsService,
    NOTIFICATION_PREFERENCE_REPOSITORY,
    IN_APP_NOTIFICATION_REPOSITORY,
    DEVICE_TOKEN_REPOSITORY,
    USER_REPOSITORY,
  ],
})
export class NotificationModule {}
