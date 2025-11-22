import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AvatarSeederService implements OnModuleInit {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedSystemAvatars();
  }

  private async seedSystemAvatars() {
    const systemAvatars = [
      {
        name: 'lion', // Standard name for upsert
        displayName: 'Lion', // User-friendly display name
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/lion',
        isSystemAvatar: true,
      },
      {
        name: 'elephant',
        displayName: 'Elephant',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/elephant',
        isSystemAvatar: true,
      },
      {
        name: 'monkey',
        displayName: 'Monkey',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/monkey',
        isSystemAvatar: true,
      },
      {
        name: 'giraffe',
        displayName: 'Giraffe',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/giraffe',
        isSystemAvatar: true,
      },
      {
        name: 'penguin',
        displayName: 'Penguin',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/penguin',
        isSystemAvatar: true,
      },
      {
        name: 'owl',
        displayName: 'Owl',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/owl',
        isSystemAvatar: true,
      },
    ];

    try {
      const existingCount = await this.prisma.avatar.count({
        where: { isSystemAvatar: true },
      });

      if (existingCount > 0) {
        this.logger.log(`Skipping system avatar seeding: ${existingCount} already exist.`);
        return; 
      }

      this.logger.log('No system avatars found. Starting seeding...');

      for (const avatarData of systemAvatars) {
        // Use upsert with name as the unique identifier
        await this.prisma.avatar.upsert({
          where: {
            name: avatarData.name,
          },
          update: {
            displayName: avatarData.displayName,
            url: avatarData.url,
            isSystemAvatar: true,
          },
          create: {
            name: avatarData.name,
            displayName: avatarData.displayName,
            url: avatarData.url,
            isSystemAvatar: true,
          },
        });

        this.logger.log(`Created system avatar: ${avatarData.displayName}`);
      }

      this.logger.log('System avatar seeding completed!');
    } catch (error) {
      this.logger.error('Error seeding system avatars:', error);
    }
  }

  // Method to manually trigger seeding if needed
  async seedAvatars() {
    await this.seedSystemAvatars();
  }
}