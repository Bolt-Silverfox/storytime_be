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
}

export async function seedStories(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding stories...');

    const storiesPath = path.resolve('prisma/data/stories.json');

    if (!fs.existsSync(storiesPath)) {
      logger.error(`Stories file not found at ${storiesPath}`);
      return {
        name: 'stories',
        success: false,
        error: 'Stories file not found',
      };
    }

    const stories: StoryData[] = JSON.parse(fs.readFileSync(storiesPath, 'utf-8'));

    let count = 0;
    for (const story of stories) {
      // Handle both string and array formats for categories
      const storyCategories = Array.isArray(story.category)
        ? story.category
        : [story.category];
      const cleanCategories = storyCategories.filter((c: string) => c && c.length > 0);

      // Handle both string and array formats for themes
      const storyThemes = Array.isArray(story.theme) ? story.theme : [story.theme];
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
      count++;
    }

    logger.success(`Seeded ${count} stories`);

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
