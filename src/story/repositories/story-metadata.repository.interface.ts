import {
  Category,
  Theme,
  StoryImage,
  StoryBranch,
  Season,
  Prisma,
} from '@prisma/client';

export type CategoryWithCount = Category & {
  _count: { stories: number };
};

export interface IStoryMetadataRepository {
  findAllCategories(): Promise<CategoryWithCount[]>;

  findCategoriesByIds(ids: string[]): Promise<Category[]>;

  findAllThemes(): Promise<Theme[]>;

  findThemesByIds(ids: string[]): Promise<Theme[]>;

  findAllSeasons(): Promise<Season[]>;

  getSeasons(): Promise<Season[]>;

  findSeasonsByIds(ids: string[]): Promise<Season[]>;

  createStoryImage(data: Prisma.StoryImageCreateInput): Promise<StoryImage>;

  createStoryBranch(data: Prisma.StoryBranchCreateInput): Promise<StoryBranch>;
}

export const STORY_METADATA_REPOSITORY = Symbol('STORY_METADATA_REPOSITORY');
