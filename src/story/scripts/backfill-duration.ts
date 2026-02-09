import { NestFactory } from '@nestjs/core';
import { StoryModule } from '../story.module';
import { StoryGenerationService } from '../story-generation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Logger } from '@nestjs/common';

async function backfillDuration() {
  const logger = new Logger('BackfillDuration');
  const BATCH_SIZE = 100; // Process stories in batches to avoid memory issues

  try {
    const app = await NestFactory.createApplicationContext(StoryModule);
    const storyGenerationService = app.get(StoryGenerationService);
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

    // Prepare update data for all stories
    const updates: { id: string; durationSeconds: number }[] = [];
    for (const story of stories) {
      let durationSeconds = 0;

      if (story.wordCount && story.wordCount > 0) {
        durationSeconds = storyGenerationService.calculateDurationSeconds(
          story.wordCount,
        );
      } else if (story.textContent) {
        durationSeconds = storyGenerationService.calculateDurationSeconds(
          story.textContent,
        );
      }

      if (durationSeconds > 0) {
        updates.push({ id: story.id, durationSeconds });
      }
    }

    logger.log(`Preparing to update ${updates.length} stories in batches of ${BATCH_SIZE}...`);

    // Process updates in batches using transactions
    let totalUpdated = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      const updateOperations = batch.map((update) =>
        prisma.story.update({
          where: { id: update.id },
          data: { durationSeconds: update.durationSeconds },
        }),
      );

      await prisma.$transaction(updateOperations);
      totalUpdated += batch.length;
      logger.log(`Processed ${totalUpdated}/${updates.length} stories...`);
    }

    logger.log(`Backfill completed: ${totalUpdated} stories updated`);
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error backfilling duration:', error);
    process.exit(1);
  }
}

void backfillDuration();
