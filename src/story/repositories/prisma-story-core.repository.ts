import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IStoryCoreRepository,
  RestrictedStoryWithStory,
} from './story-core.repository.interface';
import {
  StoryWithRelations,
  UserWithPreferences,
} from './story.repository.interface';
import { Prisma, Story, RestrictedStory, Kid } from '@prisma/client';

/**
 * Select for list views - excludes textContent to reduce payload size
 */
export const STORY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  coverImageUrl: true,
  audioUrl: true,
  isInteractive: true,
  ageMin: true,
  ageMax: true,
  durationSeconds: true,
  recommended: true,
  featured: true,
  featuredUntil: true,
  isPublished: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdById: true,
} as const;

@Injectable()
export class PrismaStoryCoreRepository implements IStoryCoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStoryById(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<Story | null> {
    return await this.prisma.story.findUnique({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
    });
  }

  async findStoryByIdWithRelations(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<StoryWithRelations | null> {
    return await this.prisma.story.findUnique({
      where: {
        id,
        ...(includeDeleted ? {} : { isDeleted: false }),
      },
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        seasons: true,
      },
    });
  }

  async findStories(params: {
    where: Prisma.StoryWhereInput;
    skip?: number;
    take?: number;
    orderBy?:
      | Prisma.StoryOrderByWithRelationInput
      | Prisma.StoryOrderByWithRelationInput[];
    include?: Prisma.StoryInclude;
    excludeContent?: boolean;
    cursor?: { id: string };
  }): Promise<StoryWithRelations[]> {
    const skipValue = params.cursor ? (params.skip ?? 0) + 1 : params.skip;

    // When excludeContent is true, use select to exclude textContent
    if (params.excludeContent) {
      return (await this.prisma.story.findMany({
        where: params.where,
        ...(params.cursor ? { cursor: { id: params.cursor.id } } : {}),
        skip: skipValue,
        take: params.take,
        orderBy: params.orderBy,
        select: {
          ...STORY_LIST_SELECT,
          images: true,
          branches: true,
          categories: true,
          themes: true,
          seasons: true,
          ...params.include,
        },
      })) as unknown as StoryWithRelations[];
    }

    return await this.prisma.story.findMany({
      where: params.where,
      ...(params.cursor ? { cursor: { id: params.cursor.id } } : {}),
      skip: skipValue,
      take: params.take,
      orderBy: params.orderBy,
      include: params.include,
    });
  }

  async countStories(where: Prisma.StoryWhereInput): Promise<number> {
    return await this.prisma.story.count({ where });
  }

  async createStory(
    data: Prisma.StoryCreateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations> {
    return await this.prisma.story.create({
      data,
      include,
    });
  }

  async updateStory(
    id: string,
    data: Prisma.StoryUpdateInput,
    include?: Prisma.StoryInclude,
  ): Promise<StoryWithRelations> {
    return await this.prisma.story.update({
      where: { id },
      data,
      include,
    });
  }

  async deleteStoryPermanently(id: string): Promise<Story> {
    return await this.prisma.story.delete({ where: { id } });
  }

  async softDeleteStory(id: string): Promise<Story> {
    return await this.prisma.story.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async restoreStory(id: string): Promise<Story> {
    return await this.prisma.story.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });
  }

  async restrictStory(
    kidId: string,
    storyId: string,
    userId: string,
    reason?: string,
  ): Promise<RestrictedStory> {
    return await this.prisma.restrictedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: {
        kidId,
        storyId,
        userId,
        reason,
      },
      update: {
        userId,
        reason,
      },
    });
  }

  async unrestrictStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory> {
    return await this.prisma.restrictedStory.delete({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async findRestrictedStories(
    kidId: string,
  ): Promise<RestrictedStoryWithStory[]> {
    return await this.prisma.restrictedStory.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  async findRestrictedStory(
    kidId: string,
    storyId: string,
  ): Promise<RestrictedStory | null> {
    return await this.prisma.restrictedStory.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async findUserByIdWithPreferences(
    userId: string,
  ): Promise<UserWithPreferences | null> {
    return await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredCategories: true },
    });
  }

  async findKidById(kidId: string): Promise<Kid | null> {
    return await this.prisma.kid.findUnique({
      where: { id: kidId },
    });
  }

  async findKidByIdAndParent(
    kidId: string,
    userId: string,
  ): Promise<Kid | null> {
    return await this.prisma.kid.findFirst({
      where: {
        id: kidId,
        parentId: userId,
      },
    });
  }

  async getRandomStoryIds(
    limit: number,
    offset: number = 0,
  ): Promise<string[]> {
    const stories = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Story"
      WHERE "isDeleted" = false
      ORDER BY RANDOM()
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return stories.map((s) => s.id);
  }
}
