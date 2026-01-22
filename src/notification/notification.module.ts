import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { InAppNotificationController } from './in-app-notification.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [HttpModule, forwardRef(() => AuthModule)],
  controllers: [NotificationController, InAppNotificationController],
  providers: [NotificationService, InAppProvider, EmailProvider],
  exports: [NotificationService],
})
export class NotificationModule { }
