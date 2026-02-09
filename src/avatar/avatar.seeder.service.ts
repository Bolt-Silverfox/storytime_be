import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { systemAvatars } from '../../prisma/data';
import { IAvatarRepository, AVATAR_REPOSITORY } from './repositories';

@Injectable()
export class AvatarSeederService implements OnModuleInit {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(
    @Inject(AVATAR_REPOSITORY)
    private readonly avatarRepository: IAvatarRepository,
  ) {}

  async onModuleInit() {
    await this.seedSystemAvatars();
  }

  private async seedSystemAvatars() {
    try {
      this.logger.log('Starting avatar seeding process...');
      this.logger.log(`Seeding ${systemAvatars.length} system avatars...`);

      // Batch all upserts concurrently via repository
      await Promise.all(
        systemAvatars.map((avatarData) =>
          this.avatarRepository.upsertByName(avatarData.name, {
            url: avatarData.url,
            isSystemAvatar: true,
          }),
        ),
      );

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
