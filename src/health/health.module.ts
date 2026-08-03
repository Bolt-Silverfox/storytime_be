import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import {
  PrismaHealthIndicator,
  RedisHealthIndicator,
  SmtpHealthIndicator,
  QueueHealthIndicator,
  TTSCircuitBreakerHealthIndicator,
} from './indicators';
import { PrismaModule } from '@/prisma/prisma.module';
import { EMAIL_QUEUE_NAME } from '@/notification/queue/email-queue.constants';
import { STORY_QUEUE_NAME } from '@/story/queue/story-queue.constants';

@Module({
  imports: [
    TerminusModule,
    PrismaModule,
    // Register the queues the QueueHealthIndicator inspects
    BullModule.registerQueue(
      { name: EMAIL_QUEUE_NAME },
      { name: STORY_QUEUE_NAME },
    ),
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SmtpHealthIndicator,
    QueueHealthIndicator,
    TTSCircuitBreakerHealthIndicator,
  ],
})
export class HealthModule {}
