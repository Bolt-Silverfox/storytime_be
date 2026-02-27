import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { InAppNotificationController } from './in-app-notification.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { DeviceTokenController } from './device-token.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { AuthModule } from '../auth/auth.module';
import { EMAIL_QUEUE_NAME } from './queue/email-queue.constants';
import { PUSH_QUEUE_NAME } from './queue/push-queue.constants';
import { EmailQueueService } from './queue/email-queue.service';
import { EmailProcessor } from './queue/email.processor';
import { PushQueueService } from './queue/push-queue.service';
import { PushProcessor } from './queue/push.processor';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => AuthModule),
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
    DeviceTokenController,
  ],
  providers: [
    NotificationService,
    InAppProvider,
    EmailProvider,
    PushProvider,
    // Email queue components
    EmailQueueService,
    EmailProcessor,
    // Push queue components
    PushQueueService,
    PushProcessor,
  ],
  exports: [NotificationService, EmailQueueService, PushQueueService],
})
export class NotificationModule {}
