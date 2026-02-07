import { NestFactory } from '@nestjs/core';
import { AchievementProgressModule } from '../achievement-progress.module';
import { BadgeService } from '../badge.service';
import { Logger } from '@nestjs/common';

async function seedBadges() {
  const logger = new Logger('BadgeSeed');

  try {
    const app = await NestFactory.createApplicationContext(
      AchievementProgressModule,
    );
    const badgeService = app.get(BadgeService);

    logger.log('Starting badge seeding...');
    await badgeService.seedBadges();

    logger.log('Badge seeding completed successfully');
    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding badges:', error);
    process.exit(1);
  }
}

seedBadges();
