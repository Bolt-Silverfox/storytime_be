import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuthModule } from '@/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
