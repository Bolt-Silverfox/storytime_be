import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { InAppNotificationController } from './in-app-notification.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';

@Module({
  imports: [HttpModule],
  controllers: [NotificationController, InAppNotificationController],
  providers: [NotificationService, InAppProvider, EmailProvider],
  exports: [NotificationService],
})
export class NotificationModule { }
