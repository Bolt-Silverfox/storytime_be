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
        name: 'Jacob', // Standard name for upsert
        displayName: 'Jacob', // User-friendly display name
        url: 'https://res.cloudinary.com/dcvz8sm8g/image/upload/v1763577787/Avatars_mbru5t.png',
        isSystemAvatar: true,
      },
      {
        name: 'Jane',
        displayName: 'Jane',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580009/Jane_ryb2k4.png',
        isSystemAvatar: true,
      },
      {
        name: 'Tim',
        displayName: 'Tim',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580023/John_v3x1mz.png',
        isSystemAvatar: true,
      },
      {
        name: 'Rice',
        displayName: 'Rice',
        url: 'https://res.cloudinary.com/dcvz8sm8g/image/upload/v1763577787/Avatars_mbru5t.png',
        isSystemAvatar: true,
      },
      {
        name: 'May',
        displayName: 'May',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580009/Jane_ryb2k4.png',
        isSystemAvatar: true,
      },
      {
        name: 'Whyte',
        displayName: 'Whyte',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580023/John_v3x1mz.png',
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