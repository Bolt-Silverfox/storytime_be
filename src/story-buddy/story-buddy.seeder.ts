import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { storyBuddiesData } from '../../prisma/data';

const prisma = new PrismaClient();

@Injectable()
export class StoryBuddySeederService implements OnModuleInit {
  private readonly logger = new Logger(StoryBuddySeederService.name);

  async onModuleInit() {
    this.logger.log('Checking for story buddies seeding...');

    try {
      await this.seedStoryBuddies();
      this.logger.log('Story buddies seeding completed successfully');
    } catch (error) {
      this.logger.error('Failed to seed story buddies:', error);
    }
  }

  async seedStoryBuddies() {
    this.logger.log('🌟 Seeding story buddies...');

    try {
      // Use createMany with skipDuplicates for efficient batch insert
      const result = await prisma.storyBuddy.createMany({
        data: storyBuddiesData,
        skipDuplicates: true,
      });

      if (result.count === 0) {
        this.logger.log(
          '✅ All story buddies already exist, skipping creation.',
        );
      } else {
        this.logger.log(
          `✨ Story buddies seeding completed! Created ${result.count} new buddies.`,
        );
      }
    } catch (error) {
      this.logger.error('❌ Error during story buddies seeding:', error);
      throw error;
    }
  }
}

// Standalone function for manual seeding (optional)
export async function seedStoryBuddies() {
  const logger = new Logger('StoryBuddySeeder');
  logger.log('🌟 Seeding story buddies...');

  try {
    // Use createMany with skipDuplicates for efficient batch insert
    const result = await prisma.storyBuddy.createMany({
      data: storyBuddiesData,
      skipDuplicates: true,
    });

    if (result.count === 0) {
      logger.log('✅ All story buddies already exist, skipping creation.');
    } else {
      logger.log(
        `✨ Story buddies seeding completed! Created ${result.count} new buddies.`,
      );
    }
  } catch (error) {
    logger.error('❌ Error during story buddies seeding:', error);
    throw error;
  }
}

// Run seeder if executed directly
if (require.main === module) {
  const bootstrapLogger = new Logger('StoryBuddySeeder');
  seedStoryBuddies()
    .catch((error) => {
      bootstrapLogger.error('Error seeding story buddies:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedStoryBuddies;
