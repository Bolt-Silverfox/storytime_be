import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import PrismaService from '../prisma/prisma.service';

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
      this.logger.log('Seeding system avatars...');

      for (const avatarData of systemAvatars) {
        // Use upsert with name as the unique identifier
        await this.prisma.avatar.upsert({
          where: { 
            name: avatarData.name // Use standard name for upsert
          },
          update: {
            displayName: avatarData.displayName,
            url: avatarData.url, // Update URL if it changed
            isSystemAvatar: true, // Ensure it stays as system avatar
          },
          create: {
            name: avatarData.name,
            displayName: avatarData.displayName,
            url: avatarData.url,
            isSystemAvatar: true,
          },
        });
        
        this.logger.log(`Upserted system avatar: ${avatarData.displayName}`);
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