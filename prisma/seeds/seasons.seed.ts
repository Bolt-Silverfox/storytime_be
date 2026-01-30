import { seasons } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedSeasons(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding seasons...');

    let count = 0;
    for (const season of seasons) {
      await prisma.season.upsert({
        where: { name: season.name },
        update: {
          description: season.description,
          startDate: season.startDate,
          endDate: season.endDate,
          isActive: true,
        },
        create: {
          name: season.name,
          description: season.description,
          startDate: season.startDate,
          endDate: season.endDate,
          isActive: true,
        },
      });
      count++;
    }

    logger.success(`Seeded ${count} seasons`);

    return {
      name: 'seasons',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed seasons', error);
    return {
      name: 'seasons',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
