import type { Prisma, Story, Category, Theme } from '@prisma/client';

// ==================== Repository Interface ====================

// Type for Story with counts
export type StoryWithCounts = Story & {
  categories: Category[];
  themes: Theme[];
  _count: {
    favorites: number;
    progresses: number;
    parentFavorites: number;
    downloads: number;
  };
};

// Type for Story detail with all relations
export type StoryDetail = Story & {
  images: any[];
  categories: Category[];
  themes: Theme[];
  branches: any[];
  questions: any[];
  _count: {
    favorites: number;
    progresses: number;
    parentFavorites: number;
    downloads: number;
  };
};

// Type for Category with counts
export type CategoryWithCounts = Category & {
  _count: {
    stories: number;
    preferredByKids: number;
  };
};

// Type for Theme with counts
export type ThemeWithCounts = Theme & {
  _count: {
    stories: number;
  };
};

// Story grouped by language with counts
export interface StoryLanguageCount {
  language: string;
  _count: number;
}

// Story age range projection
export interface StoryAgeRange {
  ageMin: number;
  ageMax: number;
}

export interface IAdminStoryRepository {
  // Find stories with pagination and filtering
  findStories(params: {
    where: Prisma.StoryWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.StoryOrderByWithRelationInput;
  }): Promise<StoryWithCounts[]>;

  // Count stories matching criteria
  countStories(where: Prisma.StoryWhereInput): Promise<number>;

  // Find story by ID with all relations
  findStoryById(storyId: string): Promise<StoryDetail | null>;

  // Find story by ID without relations (recommendation toggle / delete guard)
  findStoryBasicById(storyId: string): Promise<Story | null>;

  // Story language breakdown (content breakdown)
  groupByLanguage(): Promise<StoryLanguageCount[]>;

  // Age ranges of non-deleted stories (content breakdown)
  findAgeRanges(): Promise<StoryAgeRange[]>;

  // Update story recommendation status
  updateStoryRecommendation(params: {
    storyId: string;
    recommended: boolean;
  }): Promise<Story>;

  // Soft delete story
  softDeleteStory(storyId: string): Promise<Story>;

  // Hard delete story
  hardDeleteStory(storyId: string): Promise<Story>;

  // Check if story exists
  storyExists(storyId: string): Promise<boolean>;

  // Find categories with counts
  findCategories(): Promise<CategoryWithCounts[]>;

  // Find themes with counts
  findThemes(): Promise<ThemeWithCounts[]>;
}

export const ADMIN_STORY_REPOSITORY = Symbol('ADMIN_STORY_REPOSITORY');
