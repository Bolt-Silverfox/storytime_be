import { Module } from '@nestjs/common';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { KID_REPOSITORY, PrismaKidRepository } from './repositories';

@Module({
  imports: [AuthModule, VoiceModule, AnalyticsModule, PrismaModule],
  controllers: [KidController],
  providers: [
    KidService,
    {
      provide: KID_REPOSITORY,
      useClass: PrismaKidRepository,
    },
  ],
  exports: [KidService, KID_REPOSITORY],
})
export class KidModule {}
