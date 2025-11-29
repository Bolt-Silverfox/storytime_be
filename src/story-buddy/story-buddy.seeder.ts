import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const storyBuddiesData = [
  {
    name: 'lumina',
    displayName: 'Lumina',
    type: 'robot',
    description: 'A friendly and curious robot companion who loves learning new things and exploring stories with you.',
    imageUrl: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1764155351/Lumina_b9niso.png',
    profileAvatarUrl: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1764155351/Lumina_Avatar_wuoxcq.png',
    isActive: true,
    themeColor: '#af3f0bff',
    ageGroupMin: 1,
    ageGroupMax: 12,
  },
  {
    name: 'zylo',
    displayName: 'Zylo',
    type: 'alien',
    description: 'A magical space explorer buddy who brings the wonders of the universe into every story.',
    imageUrl: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1764155351/Zylo_qgqd3n.png',
    profileAvatarUrl: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1764155351/Zylo_Avatar.png',
    isActive: true,
    themeColor: '#2196F3',
    ageGroupMin: 1,
    ageGroupMax: 12,
  },
];

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
      // Get existing buddies to avoid duplicates
      const existingBuddies = await prisma.storyBuddy.findMany({
        select: { name: true },
      });
      
      const existingBuddyNames = new Set(existingBuddies.map(buddy => buddy.name));
      
      const buddiesToCreate = storyBuddiesData.filter(
        buddyData => !existingBuddyNames.has(buddyData.name)
      );

      if (buddiesToCreate.length === 0) {
        this.logger.log('✅ All story buddies already exist, skipping creation.');
        return;
      }

      this.logger.log(`📝 Creating ${buddiesToCreate.length} new story buddies...`);

      for (const buddyData of buddiesToCreate) {
        try {
          const buddy = await prisma.storyBuddy.create({
            data: buddyData,
          });
          this.logger.log(`✅ Created buddy: ${buddy.displayName}`);
        } catch (error) {
          this.logger.error(`❌ Error creating buddy ${buddyData.name}:`, error);
        }
      }

      this.logger.log(`✨ Story buddies seeding completed! Created ${buddiesToCreate.length} new buddies.`);
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
    // Get existing buddies to avoid duplicates
    const existingBuddies = await prisma.storyBuddy.findMany({
      select: { name: true },
    });
    
    const existingBuddyNames = new Set(existingBuddies.map(buddy => buddy.name));
    
    const buddiesToCreate = storyBuddiesData.filter(
      buddyData => !existingBuddyNames.has(buddyData.name)
    );

    if (buddiesToCreate.length === 0) {
      logger.log('✅ All story buddies already exist, skipping creation.');
      return;
    }

    logger.log(`📝 Creating ${buddiesToCreate.length} new story buddies...`);

    for (const buddyData of buddiesToCreate) {
      try {
        const buddy = await prisma.storyBuddy.create({
          data: buddyData,
        });
        logger.log(`✅ Created buddy: ${buddy.displayName}`);
      } catch (error) {
        logger.error(`❌ Error creating buddy ${buddyData.name}:`, error);
      }
    }

    logger.log(`✨ Story buddies seeding completed! Created ${buddiesToCreate.length} new buddies.`);
  } catch (error) {
    logger.error('❌ Error during story buddies seeding:', error);
    throw error;
  }
}

// Run seeder if executed directly
if (require.main === module) {
  seedStoryBuddies()
    .catch((error) => {
      console.error('Error seeding story buddies:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedStoryBuddies;