import { categories } from '../data';
import { SeedContext, SeedResult } from './types';

export async function seedCategories(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding categories...');

    const result = await prisma.category.createMany({
      data: categories,
      skipDuplicates: true,
    });

    logger.success(`Seeded ${result.count} categories`);

    return {
      name: 'categories',
      success: true,
      count: result.count,
    };
  } catch (error) {
    logger.error('Failed to seed categories', error);
    return {
      name: 'categories',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
