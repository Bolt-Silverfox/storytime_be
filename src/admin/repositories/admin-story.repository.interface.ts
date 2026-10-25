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

  // Lightweight title lookup for cross-referencing story ids returned by
  // another repository's aggregate query (e.g. reading-analytics stats).
  findTitlesByIds(storyIds: string[]): Promise<{ id: string; title: string }[]>;

  // Story language breakdown (content breakdown)
  groupByLanguage(): Promise<StoryLanguageCount[]>;

  // Age ranges of non-deleted stories (content breakdown)
  findAgeRanges(): Promise<StoryAgeRange[]>;

  // Update story recommendation status
  updateStoryRecommendation(params: {
    storyId: string;
    recommended: boolean;
  }): Promise<Story>;

  // Update story published status
  updateStoryPublished(params: {
    storyId: string;
    isPublished: boolean;
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

  // Find a single category (basic, no counts) — existence check + current
  // name/description for the AI image prompt
  findCategoryById(id: string): Promise<Category | null>;

  // Find a single theme (basic, no counts)
  findThemeById(id: string): Promise<Theme | null>;

  // Persist a newly generated/uploaded cover image URL on a category
  updateCategoryImage(id: string, image: string): Promise<Category>;

  // Persist a newly generated/uploaded cover image URL on a theme
  updateThemeImage(id: string, image: string): Promise<Theme>;
}

export const ADMIN_STORY_REPOSITORY = Symbol('ADMIN_STORY_REPOSITORY');
