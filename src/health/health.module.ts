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
  FirebaseHealthIndicator,
  CloudinaryHealthIndicator,
} from './indicators';
import { PrismaModule } from '@/prisma/prisma.module';
import { CloudinaryModule } from '@/upload/cloudinary.module';
import { EMAIL_QUEUE_NAME } from '@/notification/queue/email-queue.constants';
import { STORY_QUEUE_NAME } from '@/story/queue/story-queue.constants';
import { VOICE_QUEUE_NAME } from '@/voice/queue/voice-queue.constants';

@Module({
  imports: [
    TerminusModule,
    PrismaModule,
    CloudinaryModule,
    // Register all queues for the queue health indicator
    BullModule.registerQueue(
      { name: EMAIL_QUEUE_NAME },
      { name: STORY_QUEUE_NAME },
      { name: VOICE_QUEUE_NAME },
    ),
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    SmtpHealthIndicator,
    QueueHealthIndicator,
    FirebaseHealthIndicator,
    CloudinaryHealthIndicator,
  ],
})
export class HealthModule {}
