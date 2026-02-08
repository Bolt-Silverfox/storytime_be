import { Module } from '@nestjs/common';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [HelpSupportController],
  providers: [HelpSupportService],
})
export class HelpSupportModule {}
