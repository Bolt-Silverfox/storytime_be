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
        name: 'Jacob',
        displayName: 'Jacob',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763649806/Jacob_Avatars_y88xeg.png',
      },
      {
        name: 'Jane',
        displayName: 'Jane',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763649883/Jane_ryb2k4.png',
      },
      {
        name: 'Tim',
        displayName: 'Tim',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763649853/John_v3x1mz.png',
      },
      {
        name: 'Rachael',
        displayName: 'Rachael',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763649907/Rachael_Avatars_tgyqwv.png',
        isSystemAvatar: true,
      },
      {
        name: 'Ella',
        displayName: 'Ella',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763649943/Ella_Avatars_mhltie.png',
        isSystemAvatar: true,
      },
      {
        name: 'Angie',
        displayName: 'Angie',
        url: 'https://res.cloudinary.com/dblrgpsxr/image/upload/v1763650003/Ella_Avatars_bznuwv.png',
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