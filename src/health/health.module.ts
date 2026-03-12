import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import {
  PrismaHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  QueueHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';
import { PrismaModule } from '@/prisma/prisma.module';
import { EMAIL_QUEUE_NAME } from '@/notification/queue/email-queue.constants';

@Module({
  imports: [
    TerminusModule,
    PrismaModule,
    // Register the email queue for the queue health indicator
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
    }),
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SmtpHealthIndicator,
    QueueHealthIndicator,
    TTSCircuitBreakerHealthIndicator,
  ],
})
export class HealthModule {}
