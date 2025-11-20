import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AvatarSeederService {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedAvatars() {
    const systemAvatars = [
      {
        name: 'Jacob',
        displayName: 'Jacob',
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

    this.logger.log('Seeding system avatars...');

    for (const avatar of systemAvatars) {
      await this.prisma.avatar.upsert({
        where: { name: avatar.name },
        update: {
          displayName: avatar.displayName,
          url: avatar.url,
          isSystemAvatar: true,
        },
        create: avatar,
      });

      this.logger.log(`Upserted: ${avatar.displayName}`);
    }

    this.logger.log('Avatar seeding complete!');
  }
}
