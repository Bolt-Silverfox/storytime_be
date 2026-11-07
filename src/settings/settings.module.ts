import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuthModule } from '@/auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { SETTINGS_REPOSITORY, PrismaSettingsRepository } from './repositories';
import { AccessControlModule } from '@/shared/access/access-control.module';

@Module({
  imports: [AccessControlModule, AuthModule, PrismaModule],
  controllers: [SettingsController],
  providers: [
    SettingsService,
    {
      provide: SETTINGS_REPOSITORY,
      useClass: PrismaSettingsRepository,
    },
  ],
  exports: [SETTINGS_REPOSITORY],
})
export class SettingsModule {}
