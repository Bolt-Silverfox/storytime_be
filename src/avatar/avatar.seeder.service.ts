import { Injectable, Logger } from '@nestjs/common';
import  PrismaService  from '../prisma/prisma.service';

@Injectable()
export class AvatarSeederService {
  private readonly logger = new Logger(AvatarSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedSystemAvatars() {
    const avatars = [
      {
        name: 'Jacob',
        displayName: 'Jacob',
        url: 'https://res.cloudinary.com/dcvz8sm8g/image/upload/v1763577787/Avatars_mbru5t.png',
      },
      {
        name: 'Jane',
        displayName: 'Jane',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580009/Jane_ryb2k4.png',
      },
      {
        name: 'Tim',
        displayName: 'Tim',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763580023/John_v3x1mz.png',
      },
    ];

    this.logger.log('Seeding System Avatars...');

    for (const avatar of avatars) {
      await this.prisma.systemAvatar.upsert({
        where: { name: avatar.name },
        update: avatar,
        create: avatar,
      });

      this.logger.log(`Upserted: ${avatar.displayName}`);
    }

    this.logger.log('System Avatar seeding complete!');
  }
}
