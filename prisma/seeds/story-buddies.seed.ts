import { storyBuddiesData } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedStoryBuddies(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding story buddies...');

    let count = 0;
    for (const buddy of storyBuddiesData) {
      await prisma.storyBuddy.upsert({
        where: { name: buddy.name },
        update: {
          displayName: buddy.displayName,
          type: buddy.type,
          description: buddy.description,
          imageUrl: buddy.imageUrl,
          profileAvatarUrl: buddy.profileAvatarUrl,
          isActive: buddy.isActive,
          themeColor: buddy.themeColor,
          ageGroupMin: buddy.ageGroupMin,
          ageGroupMax: buddy.ageGroupMax,
        },
        create: {
          name: buddy.name,
          displayName: buddy.displayName,
          type: buddy.type,
          description: buddy.description,
          imageUrl: buddy.imageUrl,
          profileAvatarUrl: buddy.profileAvatarUrl,
          isActive: buddy.isActive,
          themeColor: buddy.themeColor,
          ageGroupMin: buddy.ageGroupMin,
          ageGroupMax: buddy.ageGroupMax,
        },
      });
      count++;
    }

    logger.success(`Seeded ${count} story buddies`);

    return {
      name: 'story-buddies',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed story buddies', error);
    return {
      name: 'story-buddies',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
