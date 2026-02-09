import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { systemAvatars } from '../../prisma/data';

@Injectable()
export class AvatarSeederService implements OnModuleInit {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedSystemAvatars();
  }

  private async seedSystemAvatars() {
    try {
      this.logger.log('Starting avatar seeding process...');
      this.logger.log(`Seeding ${systemAvatars.length} system avatars...`);

      // Batch all upserts in a single transaction to avoid sequential queries
      const upsertOperations = systemAvatars.map((avatarData) =>
        this.prisma.avatar.upsert({
          where: { name: avatarData.name },
          update: { url: avatarData.url },
          create: {
            name: avatarData.name,
            url: avatarData.url,
            isSystemAvatar: true,
            isDeleted: false,
            deletedAt: null,
          },
        }),
      );

      await this.prisma.$transaction(upsertOperations);

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
