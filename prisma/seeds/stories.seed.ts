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
    logger.log('Seeding stories...');

    const dataDir = path.resolve('prisma/data');
    if (!fs.existsSync(dataDir)) {
      logger.error(`Data directory not found at ${dataDir}`);
      return {
        name: 'stories',
        success: false,
        error: 'Data directory not found',
      };
    }

    // Find all files matching stories*.json
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('stories') && file.endsWith('.json') && !file.includes('backup'));

    if (files.length === 0) {
      logger.error(`No stories*.json files found in ${dataDir}`);
      return {
        name: 'stories',
        success: true,
        count: 0,
      };
    }

    let totalCount = 0;

    for (const file of files) {
      logger.log(`Processing stories file: ${file}`);
      const filePath = path.join(dataDir, file);

      const stories: StoryData[] = JSON.parse(
        fs.readFileSync(filePath, 'utf-8'),
      );

      for (const story of stories) {
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
        const cleanThemes = storyThemes.filter((t: string) => t && t.length > 0);

        await prisma.story.create({
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
                connect: story.seasons.map((name: string) => ({ name })),
              }
              : undefined,
            questions: {
              create: story.questions.map((question: StoryQuestion) => ({
                question: question.question,
                options: question.options,
                correctOption: question.correctOption,
              })),
            },
          },
        });
        totalCount++;
      }
    }

    logger.success(`Seeded ${totalCount} stories from ${files.length} files`);

    return {
      name: 'stories',
      success: true,
      count: totalCount,
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
