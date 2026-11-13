import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { STORY_QUEUE_NAME } from '../story/queue/story-queue.constants';
import { EMAIL_QUEUE_NAME } from '../notification/queue/email-queue.constants';
import { bullBoardOptionsFromConfig } from './bull-board-auth';

@Module({
  imports: [
    BullBoardModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => bullBoardOptionsFromConfig(config),
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
