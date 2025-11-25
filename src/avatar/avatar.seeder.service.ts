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
        name: 'Avatar one',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_1_omlrrp.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar two',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_2_lf3d8d.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar three',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_3_fygzbx.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar four',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_4_ydnjr3.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar five',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_5_p7reje.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar six',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_6_qpkooe.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar seven',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976793/avatar_7_mroqmx.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar eight',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976792/avatar_8_t39vrz.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar nine',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976792/avatar_9_ps2syi.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar ten',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976792/avatar_10_bllu0q.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar eleven',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976792/avatar_11_uiytjf.png',
        isSystemAvatar: true,
      },
      {
        name: 'Avatar twelve',
        url: 'https://res.cloudinary.com/dbt4qvman/image/upload/v1763976792/avatar_12_lmggcb.png',
        isSystemAvatar: true,
      },
    ];

    try {
      // Get all existing avatar names
      const existingAvatars = await this.prisma.avatar.findMany({
        where: {
          name: {
            in: systemAvatars.map((a) => a.name),
          },
        },
        select: {
          name: true,
        },
      });

      const existingNames = new Set(existingAvatars.map((a) => a.name));

      // Filter out avatars that already exist
      const avatarsToCreate = systemAvatars.filter(
        (avatar) => !existingNames.has(avatar.name),
      );

      // Skip if all avatars already exist
      if (avatarsToCreate.length === 0) {
        this.logger.log('All system avatars already exist. Skipping seeding.');
        return;
      }

      this.logger.log(
        `Seeding ${avatarsToCreate.length} new system avatars...`,
      );

      // Create only new avatars
      for (const avatarData of avatarsToCreate) {
        await this.prisma.avatar.create({
          data: {
            name: avatarData.name,
            url: avatarData.url,
            isSystemAvatar: true,
          },
        });

        this.logger.log(`Created system avatar: ${avatarData.name}`);
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