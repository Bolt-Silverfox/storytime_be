import * as fs from 'fs';
import * as path from 'path';
import { SeedContext, SeedResult } from './types';

interface StoryQuestion {
  question: string;
  options: string[];
  correctOption: number;
}

interface StoryData {
  title: string;
  description: string;
  language: string;
  coverImageUrl: string;
  audioUrl?: string;
  isInteractive?: boolean;
  ageMin?: number;
  ageMax?: number;
  content: string;
  recommended?: boolean;
  backgroundColor?: string;
  category: string | string[];
  theme: string | string[];
  seasons?: string[];
  questions: StoryQuestion[];
  wordCount?: number;
  durationSeconds?: number;
  difficultyLevel?: number;
  aiGenerated?: boolean;
}

export async function seedStories(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    // 1. Determine environment
    const env = process.env.NODE_ENV || 'development';
    const isProduction = env === 'production';
    const dataDir = path.resolve('prisma/data');
    if (!fs.existsSync(dataDir)) {
      logger.error(`Data directory not found at ${dataDir}`);
      return {
        name: 'stories',
        success: false,
        error: 'Data directory not found',
      };
    }

    const files = fs.readdirSync(dataDir).filter((file) => {
      if (!file.startsWith('stories') || !file.endsWith('.json') || file.includes('backup')) {
        return false;
      }

      if (isProduction) {
        return file.endsWith('.production.json');
      }
      return !file.endsWith('.production.json');
    });

    logger.log(`Found ${files.length} files to process in ${env} mode.`);

    if (files.length === 0) {
      logger.error(`No stories*.json files found in ${dataDir}`);
      return {
        name: 'stories',
        success: false,
        error: 'No stories JSON files found',
      };
    }

    // Pre-fetch existing titles to avoid duplicates
    const existingStories = await prisma.story.findMany({
      select: { title: true },
    });
    const existingTitles = new Set(
      existingStories.map((s) => s.title.trim().toLowerCase()),
    );

    let count = 0;
    let skipped = 0;

    for (const file of files) {
      logger.log(`Processing stories file: ${file}`);
      const filePath = path.join(dataDir, file);

      let stories: StoryData[];
      try {
        stories = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        logger.error(`Skipping malformed JSON file: ${file}`);
        continue;
      }

      let localCount = 0;
      let localSkipped = 0;
      let createdTitlesThisTx: string[] = [];

      await prisma.$transaction(async (tx) => {
        // Reset local trackers on possible transaction retries
        localCount = 0;
        localSkipped = 0;
        createdTitlesThisTx = [];

        for (const story of stories) {
          if (!story.title) {
            logger.error(`Skipping story without a title in ${file}`);
            continue;
          }
          const normalizedTitle = story.title.trim().toLowerCase();
          if (
            existingTitles.has(normalizedTitle) ||
            createdTitlesThisTx.includes(normalizedTitle)
          ) {
            localSkipped++;
            continue;
          }

          // Handle both string and array formats for categories
          const storyCategories = Array.isArray(story.category)
            ? story.category
            : [story.category];
          const cleanCategories = storyCategories.filter(
            (c: string) => c && c.length > 0,
          );

          // Handle both string and array formats for themes
          const storyThemes = Array.isArray(story.theme)
            ? story.theme
            : [story.theme];
          const cleanThemes = storyThemes.filter(
            (t: string) => t && t.length > 0,
          );

          await tx.story.create({
            data: {
              title: story.title,
              description: story.description,
              language: story.language,
              coverImageUrl: story.coverImageUrl,
              audioUrl: story.audioUrl ?? '',
              isInteractive: story.isInteractive ?? false,
              ageMin: story.ageMin ?? 0,
              ageMax: story.ageMax ?? 9,
              textContent: story.content,
              recommended: story.recommended ?? false,
              backgroundColor: story.backgroundColor || '#5E3A54',
              wordCount: story.wordCount ?? 0,
              durationSeconds: story.durationSeconds ?? null,
              difficultyLevel: story.difficultyLevel ?? 1,
              aiGenerated: story.aiGenerated ?? false,
              categories: {
                connectOrCreate: cleanCategories.map((name: string) => ({
                  where: { name },
                  create: {
                    name,
                    description: 'Auto-generated category',
                  },
                })),
              },
              themes: {
                connectOrCreate: cleanThemes.map((name: string) => ({
                  where: { name },
                  create: {
                    name,
                    description: 'Auto-generated theme',
                  },
                })),
              },
              seasons: story.seasons
                ? {
                  connectOrCreate: story.seasons.map((name: string) => ({
                    where: { name },
                    create: { name },
                  })),
                }
                : undefined,
              questions: {
                create: (story.questions || []).map(
                  (question: StoryQuestion) => ({
                    question: question.question,
                    options: question.options,
                    correctOption: question.correctOption,
                  }),
                ),
              },
            },
          });

          createdTitlesThisTx.push(normalizedTitle);
          localCount++;
        }
      });

      // Transaction succeeded, safely commit local tracking to global state
      createdTitlesThisTx.forEach((t) => existingTitles.add(t));
      count += localCount;
      skipped += localSkipped;
    }

    logger.success(
      `Seeded ${count} stories from ${files.length} files (${skipped} skipped as duplicates)`,
    );

    return {
      name: 'stories',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed stories', error);
    return {
      name: 'stories',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
