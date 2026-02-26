import { learningExpectations } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedLearningExpectations(
  ctx: SeedContext,
): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding learning expectations...');

    let count = 0;
    for (const expectation of learningExpectations) {
      await prisma.learningExpectation.upsert({
        where: { name: expectation.name },
        update: {
          description: expectation.description,
          isActive: true,
        },
        create: {
          ...expectation,
          isActive: true,
        },
      });
      count++;
    }

    logger.success(`Seeded ${count} learning expectations`);

    return {
      name: 'learning-expectations',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed learning expectations', error);
    return {
      name: 'learning-expectations',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
