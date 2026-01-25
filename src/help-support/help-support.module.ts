import { Module } from '@nestjs/common';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, NotificationModule, ConfigModule, AuthModule],
  controllers: [HelpSupportController],
  providers: [HelpSupportService]
})
export class HelpSupportModule { }
