import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { storyBuddiesData } from '../../prisma/data';

@Injectable()
export class StoryBuddySeederService implements OnModuleInit {
  private readonly logger = new Logger(StoryBuddySeederService.name);
  private prisma: PrismaClient | null = null;

  private getPrisma(): PrismaClient | null {
    if (this.prisma) return this.prisma;

    const url = process.env.DIRECT_DATABASE_URL;
    if (!url) {
      this.logger.warn(
        'DIRECT_DATABASE_URL not set — skipping story buddy seeding',
      );
      return null;
    }

    this.prisma = new PrismaClient({ datasourceUrl: url });
    return this.prisma;
  }

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
    const prisma = this.getPrisma();
    if (!prisma) return;

    this.logger.log('🌟 Seeding story buddies...');

    try {
      // Get existing buddies to avoid duplicates
      const existingBuddies = await prisma.storyBuddy.findMany({
        select: { name: true },
      });

      const existingBuddyNames = new Set(
        existingBuddies.map((buddy) => buddy.name),
      );

      const buddiesToCreate = storyBuddiesData.filter(
        (buddyData) => !existingBuddyNames.has(buddyData.name),
      );

      if (buddiesToCreate.length === 0) {
        this.logger.log(
          '✅ All story buddies already exist, skipping creation.',
        );
        return;
      }

      this.logger.log(
        `📝 Creating ${buddiesToCreate.length} new story buddies...`,
      );

      for (const buddyData of buddiesToCreate) {
        try {
          const buddy = await prisma.storyBuddy.create({
            data: buddyData,
          });
          this.logger.log(`✅ Created buddy: ${buddy.displayName}`);
        } catch (error) {
          this.logger.error(
            `❌ Error creating buddy ${buddyData.name}:`,
            error,
          );
        }
      }

      this.logger.log(
        `✅ Story buddy seeding complete. Created ${buddiesToCreate.length} buddies.`,
      );
    } finally {
      await prisma.$disconnect();
      this.prisma = null;
    }
  }
}
