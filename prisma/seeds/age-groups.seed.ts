import { defaultAgeGroups } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedAgeGroups(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding age groups...');

    // Upsert all age groups from data
    let count = 0;
    for (const group of defaultAgeGroups) {
      await prisma.ageGroup.upsert({
        where: { name: group.name },
        update: { min: group.min, max: group.max, isDeleted: false },
        create: { name: group.name, min: group.min, max: group.max },
      });
      count++;
    }

    // Remove outdated age groups not in the current data
    const validNames = defaultAgeGroups.map((g) => g.name);
    const deleted = await prisma.ageGroup.deleteMany({
      where: { name: { notIn: validNames } },
    });

    if (deleted.count > 0) {
      logger.log(`Removed ${deleted.count} outdated age groups`);
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
