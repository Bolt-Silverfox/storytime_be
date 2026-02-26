import { PrismaClient } from '@prisma/client';
import { seedCategories } from './categories.seed';
import { seedStories } from './stories.seed';
import { createSeedLogger } from './types';

export async function prodContentReset(prisma: PrismaClient) {
  const logger = createSeedLogger('prod-reset');

  if (process.env.CONFIRM_RESET !== 'true') {
    const msg =
      'Missing CONFIRM_RESET=true environment variable. Aborting destructive reset.';
    logger.error(msg);
    throw new Error(msg);
  }

  logger.log('Starting production content reset...');

  try {
    // 0. Pre-cleanup of non-cascading relations that might block Story deletion
    logger.log('Cleaning up dependent data...');

    // DailyChallengeAssignments block DailyChallenge deletion (which is cascaded from Story)
    await prisma.dailyChallengeAssignment.deleteMany({});

    // StoryPath blocks Story deletion (no cascade on story relation)
    await prisma.storyPath.deleteMany({});

    // 1. Delete all Stories
    // This will cascade to:
    // - StoryImages
    // - StoryQuestions -> QuestionAnswers
    // - StoryBranches
    // - Favorites / ParentFavorites
    // - StoryProgress / UserStoryProgress
    // - DailyChallenges (after assignments are gone)
    // - DownloadedStory
    // - RestrictedStory
    // - ParentRecommendation
    // - StoryAudioCache
    logger.log('Deleting all existing stories...');
    const deletedStories = await prisma.story.deleteMany();
    logger.success(`Deleted ${deletedStories.count} stories.`);

    // 2. Delete all Categories
    // Implicit many-to-many with Stories is handled by Prisma.
    // User/Kid preferences are implicit m-n, usually handled safely by Prisma or might need manual cleanup if not cascading.
    // Explicit check: implicit m-n tables cascade on delete of either side usually.
    logger.log('Deleting all existing categories...');
    const deletedCategories = await prisma.category.deleteMany();
    logger.success(`Deleted ${deletedCategories.count} categories.`);

    // 3. Seed New Categories
    logger.log('Seeding new categories...');
    const catRes = await seedCategories({ prisma, logger });
    if (!catRes.success) {
      throw new Error(catRes.error || 'Failed to seed categories');
    }

    // 4. Seed New Stories
    // This expects prisma/data/stories*.json to be populated with NEW stories.
    logger.log('Seeding new stories...');
    const storyRes = await seedStories({ prisma, logger });
    if (!storyRes.success) {
      throw new Error(storyRes.error || 'Failed to seed stories');
    }

    logger.success('Production content reset complete!');
  } catch (error) {
    logger.error('Failed to reset content', error);
    throw error;
  }
}

// Allow running directly if main module
if (require.main === module) {
  const prisma = new PrismaClient();
  prodContentReset(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
