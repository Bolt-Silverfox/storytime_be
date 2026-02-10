import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IAdminStoryRepository,
  StoryWithCounts,
  StoryDetail,
  CategoryWithCounts,
  ThemeWithCounts,
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

  async updateStoryRecommendation(params: {
    storyId: string;
    recommended: boolean;
  }): Promise<Story> {
    return this.prisma.story.update({
      where: { id: params.storyId },
      data: { recommended: params.recommended },
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
