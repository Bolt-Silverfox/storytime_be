import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { InAppNotificationService } from './services/in-app-notification.service';
import { EventNotificationService } from './services/event-notification.service';
import { NotificationController } from './notification.controller';
import { InAppNotificationController } from './in-app-notification.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { EMAIL_QUEUE_NAME } from './queue/email-queue.constants';
import { EmailQueueService } from './queue/email-queue.service';
import { EmailProcessor } from './queue/email.processor';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  PrismaNotificationPreferenceRepository,
  IN_APP_NOTIFICATION_REPOSITORY,
  PrismaInAppNotificationRepository,
} from './repositories';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    forwardRef(() => AuthModule),
    // Register email queue
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
    }),
  ],
  controllers: [
    NotificationController,
    InAppNotificationController,
    UserPreferencesController,
  ],
  providers: [
    NotificationService,
    NotificationPreferenceService,
    InAppNotificationService,
    EventNotificationService,
    InAppProvider,
    EmailProvider,
    // Queue components
    EmailQueueService,
    EmailProcessor,
    {
      provide: NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: PrismaNotificationPreferenceRepository,
    },
    {
      provide: IN_APP_NOTIFICATION_REPOSITORY,
      useClass: PrismaInAppNotificationRepository,
    },
  ],
  exports: [
    NotificationService,
    NotificationPreferenceService,
    InAppNotificationService,
    EmailQueueService,
  ],
})
export class NotificationModule {}
