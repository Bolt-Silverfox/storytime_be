import { NestFactory } from '@nestjs/core';
import { StoryModule } from '../story.module';
import { StoryService } from '../story.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Logger } from '@nestjs/common';

async function backfillDuration() {
  const logger = new Logger('BackfillDuration');

  try {
    const app = await NestFactory.createApplicationContext(StoryModule);
    const storyService = app.get(StoryService);
    const prisma = app.get(PrismaService);

    logger.log('Starting story duration backfill...');

    // Get all stories without duration
    const stories = await prisma.story.findMany({
      where: {
        isDeleted: false,
        durationSeconds: null,
      },
      select: {
        id: true,
        wordCount: true,
        textContent: true,
      },
    });

    logger.log(`Found ${stories.length} stories without duration`);

    let updated = 0;
    for (const story of stories) {
      // Calculate duration from wordCount if available, otherwise from textContent
      let durationSeconds = 0;

      if (story.wordCount && story.wordCount > 0) {
        durationSeconds = storyService.calculateDurationSeconds(story.wordCount);
      } else if (story.textContent) {
        durationSeconds = storyService.calculateDurationSeconds(story.textContent);
      }

      if (durationSeconds > 0) {
        await prisma.story.update({
          where: { id: story.id },
          data: { durationSeconds },
        });
        updated++;
      }
    }

    logger.log(`Backfill completed: ${updated} stories updated`);
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error backfilling duration:', error);
    process.exit(1);
  }
}

backfillDuration();
