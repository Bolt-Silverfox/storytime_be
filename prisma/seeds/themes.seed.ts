import { themes } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedThemes(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding themes...');

    const result = await prisma.theme.createMany({
      data: themes,
      skipDuplicates: true,
    });

    logger.success(`Seeded ${result.count} themes`);

    return {
      name: 'themes',
      success: true,
      count: result.count,
    };
  } catch (error) {
    logger.error('Failed to seed themes', error);
    return {
      name: 'themes',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
