import { systemAvatars } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedAvatars(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding avatars...');

    const existingAvatars = await prisma.avatar.findMany({
      where: { name: { in: systemAvatars.map((a) => a.name) } },
      select: { name: true },
    });

    const existingNames = new Set(existingAvatars.map((a) => a.name));
    const avatarsToCreate = systemAvatars.filter(
      (avatar) => !existingNames.has(avatar.name),
    );

    let count = 0;
    for (const avatarData of avatarsToCreate) {
      await prisma.avatar.create({
        data: {
          name: avatarData.name,
          url: avatarData.url,
          isSystemAvatar: true,
          isDeleted: false,
          deletedAt: null,
        },
      });
      count++;
    }

    logger.success(
      `Seeded ${count} new avatars (${existingNames.size} already existed)`,
    );

    return {
      name: 'avatars',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed avatars', error);
    return {
      name: 'avatars',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
