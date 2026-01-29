import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule, ConfigModule],
  controllers: [HelpSupportController],
  providers: [HelpSupportService]
})
export class HelpSupportModule { }
