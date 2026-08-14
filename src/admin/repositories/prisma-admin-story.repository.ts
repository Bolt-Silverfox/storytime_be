import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IAdminStoryRepository,
  StoryWithCounts,
  StoryDetail,
  CategoryWithCounts,
  ThemeWithCounts,
  StoryLanguageCount,
  StoryAgeRange,
} from './admin-story.repository.interface';
import type { Prisma, Story } from '@prisma/client';

@Injectable()
export class PrismaAdminStoryRepository implements IAdminStoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStories(params: {
    where: Prisma.StoryWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.StoryOrderByWithRelationInput;
  }): Promise<StoryWithCounts[]> {
    return this.prisma.story.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: {
        categories: true,
        themes: true,
        _count: {
          select: {
            favorites: true,
            progresses: true,
            parentFavorites: true,
            downloads: true,
          },
        },
      },
    }) as Promise<StoryWithCounts[]>;
  }

  async countStories(where: Prisma.StoryWhereInput): Promise<number> {
    return this.prisma.story.count({ where });
  }

  async findStoryById(storyId: string): Promise<StoryDetail | null> {
    return this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        images: true,
        categories: true,
        themes: true,
        branches: true,
        questions: true,
        _count: {
          select: {
            favorites: true,
            progresses: true,
            parentFavorites: true,
            downloads: true,
          },
        },
      },
    }) as Promise<StoryDetail | null>;
  }

  findStoryBasicById(storyId: string): Promise<Story | null> {
    return this.prisma.story.findUnique({
      where: { id: storyId },
    });
  }

  async groupByLanguage(): Promise<StoryLanguageCount[]> {
    const result = await this.prisma.story.groupBy({
      by: ['language'],
      where: { isDeleted: false },
      _count: true,
    });
    return result as StoryLanguageCount[];
  }

  findAgeRanges(): Promise<StoryAgeRange[]> {
    return this.prisma.story.findMany({
      where: { isDeleted: false },
      select: { ageMin: true, ageMax: true },
    });
  }

  async updateStoryRecommendation(params: {
    storyId: string;
    recommended: boolean;
  }): Promise<Story> {
    return this.prisma.story.update({
      where: { id: params.storyId },
      data: { recommended: params.recommended },
    });
  }

  async updateStoryPublished(params: {
    storyId: string;
    isPublished: boolean;
  }): Promise<Story> {
    return this.prisma.story.update({
      where: { id: params.storyId },
      data: { isPublished: params.isPublished },
    });
  }

  async softDeleteStory(storyId: string): Promise<Story> {
    return this.prisma.story.update({
      where: { id: storyId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async hardDeleteStory(storyId: string): Promise<Story> {
    return this.prisma.story.delete({ where: { id: storyId } });
  }

  async storyExists(storyId: string): Promise<boolean> {
    const count = await this.prisma.story.count({
      where: { id: storyId },
    });
    return count > 0;
  }

  async findCategories(): Promise<CategoryWithCounts[]> {
    return this.prisma.category.findMany({
      where: { isDeleted: false },
      include: {
        _count: {
          select: {
            stories: true,
            preferredByKids: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }) as Promise<CategoryWithCounts[]>;
  }

  async findThemes(): Promise<ThemeWithCounts[]> {
    return this.prisma.theme.findMany({
      where: { isDeleted: false },
      include: {
        _count: {
          select: {
            stories: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }) as Promise<ThemeWithCounts[]>;
  }
}
