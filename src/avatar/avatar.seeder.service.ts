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

      // 1. Unlink avatars from Users and Kids to avoid FK constraints
      this.logger.log('Unlinking avatars from users and kids...');
      await this.prisma.user.updateMany({
        data: { avatarId: null },
      });
      await this.prisma.kid.updateMany({
        data: { avatarId: null },
      });

      // 2. Truncate the Avatar table (delete all records)
      this.logger.log('Truncating Avatar table...');
      await this.prisma.avatar.deleteMany({});

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