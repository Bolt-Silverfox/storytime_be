import { defaultAgeGroups } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedAgeGroups(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding age groups...');

    let count = 0;
    for (const group of defaultAgeGroups) {
      await prisma.ageGroup.upsert({
        where: { name: group.name },
        update: { min: group.min, max: group.max },
        create: { name: group.name, min: group.min, max: group.max },
      });
      count++;
    }

    logger.success(`Seeded ${count} age groups`);

    return {
      name: 'age-groups',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed age groups', error);
    return {
      name: 'age-groups',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
