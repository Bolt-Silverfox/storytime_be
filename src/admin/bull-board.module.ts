import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { STORY_QUEUE_NAME } from '../story/queue/story-queue.constants';
import { EMAIL_QUEUE_NAME } from '../notification/queue/email-queue.constants';
import { bullBoardRootOptions } from './bull-board-auth';

/**
 * Bull Board Module for queue monitoring dashboard
 *
 * Access: /admin/queues behind HTTP Basic auth (BULL_BOARD_USER and
 * BULL_BOARD_PASSWORD); not served at all while either is unset
 *
 * Features:
 * - Real-time job monitoring
 * - Job retry/remove capabilities
 * - Queue statistics (completed, failed, waiting, active)
 * - Job details and error inspection
 */
@Module({
  imports: [
    BullBoardModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        bullBoardRootOptions(
          config.get<string>('BULL_BOARD_USER'),
          config.get<string>('BULL_BOARD_PASSWORD'),
        ),
    }),
    BullBoardModule.forFeature(
      {
        name: STORY_QUEUE_NAME,
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
