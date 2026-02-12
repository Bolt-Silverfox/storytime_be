import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { STORY_QUEUE_NAME } from '../story/queue/story-queue.constants';
import { VOICE_QUEUE_NAME } from '../voice/queue/voice-queue.constants';
import { EMAIL_QUEUE_NAME } from '../notification/queue/email-queue.constants';

/**
 * Bull Board Module for queue monitoring dashboard
 *
 * Access: /admin/queues
 *
 * Features:
 * - Real-time job monitoring
 * - Job retry/remove capabilities
 * - Queue statistics (completed, failed, waiting, active)
 * - Job details and error inspection
 */
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature(
      {
        name: STORY_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
      {
        name: VOICE_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
      {
        name: EMAIL_QUEUE_NAME,
        adapter: BullMQAdapter,
      },
    ),
  ],
})
export class BullBoardConfigModule {}
