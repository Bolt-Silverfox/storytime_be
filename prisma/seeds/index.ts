import { PrismaClient } from '@prisma/client';
import { createSeedLogger, SeedContext, SeedResult } from './types';

// Import all seed functions
import { seedCategories } from './categories.seed';
import { seedThemes } from './themes.seed';
import { seedAgeGroups } from './age-groups.seed';
import { seedLearningExpectations } from './learning-expectations.seed';
import { seedSeasons } from './seasons.seed';
import { seedVoices } from './voices.seed';
import { seedAvatars } from './avatars.seed';
import { seedStoryBuddies } from './story-buddies.seed';
import { seedStories } from './stories.seed';

const prisma = new PrismaClient();

/**
 * Main seed orchestrator
 *
 * Seeds are executed in a specific order to respect dependencies:
 * 1. Reference data (categories, themes, age groups, seasons, learning expectations)
 * 2. Voice and avatar assets
 * 3. Story buddies
 * 4. Stories (depends on categories, themes, seasons)
 */
async function main(): Promise<void> {
  const logger = createSeedLogger('Seed');
  const ctx: SeedContext = { prisma, logger };

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Storytime Database Seeder');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const results: SeedResult[] = [];

  // Phase 1: Reference data (can be run in parallel, but sequential for cleaner logs)
  logger.log('Phase 1: Seeding reference data...');
  results.push(await seedCategories(ctx));
  results.push(await seedThemes(ctx));
  results.push(await seedAgeGroups(ctx));
  results.push(await seedLearningExpectations(ctx));
  results.push(await seedSeasons(ctx));

  // Phase 2: Assets
  logger.log('Phase 2: Seeding assets...');
  results.push(await seedVoices(ctx));
  results.push(await seedAvatars(ctx));

  // Phase 3: Story buddies
  logger.log('Phase 3: Seeding story buddies...');
  results.push(await seedStoryBuddies(ctx));

  // Phase 4: Stories (depends on categories, themes, seasons)
  logger.log('Phase 4: Seeding stories...');
  results.push(await seedStories(ctx));

  // Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Seed Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const count = result.count !== undefined ? ` (${result.count})` : '';
    console.log(`  ${status} ${result.name}${count}`);
    if (result.error) {
      console.log(`    └─ Error: ${result.error}`);
    }
  }

  console.log('');
  console.log(`  Total: ${successful.length} succeeded, ${failed.length} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (failed.length > 0) {
    throw new Error(`${failed.length} seed(s) failed`);
  }
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
