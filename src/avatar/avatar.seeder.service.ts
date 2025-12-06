import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { systemAvatars } from '../../prisma/data';

@Injectable()
export class AvatarSeederService implements OnModuleInit {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(private readonly prisma: PrismaService) { }

  async onModuleInit() {
    await this.seedSystemAvatars();
  }

  private async seedSystemAvatars() {
    try {
      this.logger.log('Starting avatar seeding process...');

      for (const avatarData of systemAvatars) {
        await this.prisma.avatar.upsert({
          where: { name: avatarData.name },
          update: {
            url: avatarData.url,
            isSystemAvatar: true,
          },
          create: {
            name: avatarData.name,
            url: avatarData.url,
            isSystemAvatar: true,
            isDeleted: false,
          },
        });
      }

      this.logger.log(`Seeding completed for ${systemAvatars.length} system avatars.`);
    } catch (error) {
      this.logger.error('Error seeding system avatars:', error);
    }
  }

  // Method to manually trigger seeding if needed
  async seedAvatars() {
    await this.seedSystemAvatars();
  }
}