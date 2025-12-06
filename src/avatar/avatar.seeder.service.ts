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
      const existingAvatarsCount = await this.prisma.avatar.count({
        where: { isSystemAvatar: true },
      });

      if (existingAvatarsCount >= systemAvatars.length) {
        for (const avatarData of systemAvatars) {
          const existingAvatar = await this.prisma.avatar.findFirst({
            where: {
              name: avatarData.name,
              isSystemAvatar: true,
            },
          });
          if (!existingAvatar) {
            this.logger.log(`Seeding missing system avatar: ${avatarData.name}`);
            await this.prisma.avatar.create({
              data: {
                name: avatarData.name,
                url: avatarData.url,
                isSystemAvatar: true,
                isDeleted: false,
                deletedAt: null,
              },
            });
          } else {
            await this.prisma.avatar.update({
              where: { id: existingAvatar.id },
              data: { url: avatarData.url },
            });
            this.logger.log(`Updated system avatar URL: ${avatarData.name}`);
          }
        }
      }

      // 3. Populate avatars
      this.logger.log(`Seeding ${systemAvatars.length} system avatars...`);
      for (const avatarData of systemAvatars) {
        await this.prisma.avatar.create({
          data: {
            name: avatarData.name,
            url: avatarData.url,
            isSystemAvatar: true,
            isDeleted: false,
            deletedAt: null,
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