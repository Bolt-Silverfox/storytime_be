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
        name: 'Avatar 1 - Lion',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/lion',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar 2 - Elephant',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/elephant',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar 3 - Monkey',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/monkey',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar 4 - Giraffe',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/giraffe',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar 5 - Penguin',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/penguin',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar 6 - Owl',
        url: 'https://res.cloudinary.com/your-cloud-name/image/upload/v1/avatars/owl',
        isSystemAvatar: true,
      },
    ];

    try {
      this.logger.log('Checking for system avatars...');

      for (const avatarData of systemAvatars) {
        const existingAvatar = await this.prisma.avatar.findFirst({
          where: { url: avatarData.url },
        });

        if (!existingAvatar) {
          await this.prisma.avatar.create({
            data: avatarData,
          });
          this.logger.log(`Created system avatar: ${avatarData.name}`);
        } else {
          this.logger.log(`System avatar already exists: ${avatarData.name}`);
        }
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