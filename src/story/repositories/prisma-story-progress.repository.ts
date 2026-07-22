import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IStoryProgressRepository,
  StoryProgressWithStory,
  UserStoryProgressWithStory,
  ProgressPageOptions,
} from './story-progress.repository.interface';
import {
  StoryProgress,
  UserStoryProgress,
  Story,
  Kid,
  User,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PrismaStoryProgressRepository implements IStoryProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findKidById(id: string): Promise<Kid | null> {
    return await this.prisma.kid.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findStoryById(id: string): Promise<Story | null> {
    return await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async updateKidReadingLevel(kidId: string, newLevel: number): Promise<Kid> {
    return await this.prisma.kid.update({
      where: { id: kidId },
      data: { currentReadingLevel: newLevel },
    });
  }

  async findStoryProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress | null> {
    return await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async upsertKidProgress(
    kidId: string,
    storyId: string,
    data: { progress: number; completed: boolean; sessionTime: number },
  ): Promise<StoryProgress> {
    return await this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      update: {
        progress: data.progress,
        // Monotonic completion: only ever flip to true, never downgrade an
        // already-completed record (mirrors the guest progress repository).
        ...(data.completed ? { completed: true } : {}),
        lastAccessed: new Date(),
        totalTimeSpent: { increment: data.sessionTime },
      },
      create: {
        kidId,
        storyId,
        progress: data.progress,
        completed: data.completed,
        totalTimeSpent: data.sessionTime,
      },
    });
  }

  async findContinueReadingProgress(
    kidId: string,
    opts?: ProgressPageOptions,
  ): Promise<StoryProgressWithStory[]> {
    return (await this.prisma.storyProgress.findMany({
      where: {
        kidId,
        progress: { gt: 0 },
        completed: false,
        isDeleted: false,
        story: { isDeleted: false },
      },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      include: { story: { include: { categories: true } } },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })) as StoryProgressWithStory[];
  }

  async findCompletedProgress(
    kidId: string,
    opts?: ProgressPageOptions,
  ): Promise<StoryProgressWithStory[]> {
    return (await this.prisma.storyProgress.findMany({
      where: {
        kidId,
        completed: true,
        isDeleted: false,
        story: { isDeleted: false },
      },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      include: { story: { include: { categories: true } } },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })) as StoryProgressWithStory[];
  }

  async findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null> {
    return await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
    });
  }

  async findActiveUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgress | null> {
    return await this.prisma.userStoryProgress.findFirst({
      where: { userId, storyId, isDeleted: false },
    });
  }

  async upsertUserProgress(
    userId: string,
    storyId: string,
    data: {
      progress: number;
      completed: boolean;
      createTotalTimeSpent: number;
      updateTotalTimeSpent: number | Prisma.IntFieldUpdateOperationsInput;
    },
  ): Promise<UserStoryProgress> {
    return await this.prisma.userStoryProgress.upsert({
      where: { userId_storyId: { userId, storyId } },
      update: {
        progress: data.progress,
        // Monotonic completion: only ever flip to true, never downgrade an
        // already-completed record (mirrors the guest progress repository).
        ...(data.completed ? { completed: true } : {}),
        lastAccessed: new Date(),
        totalTimeSpent: data.updateTotalTimeSpent,
        isDeleted: false,
        deletedAt: null,
      },
      create: {
        userId,
        storyId,
        progress: data.progress,
        completed: data.completed,
        totalTimeSpent: data.createTotalTimeSpent,
      },
    });
  }

  async findUserContinueReadingProgress(
    userId: string,
    opts?: ProgressPageOptions,
  ): Promise<UserStoryProgressWithStory[]> {
    return (await this.prisma.userStoryProgress.findMany({
      where: {
        userId,
        progress: { gt: 0 },
        completed: false,
        isDeleted: false,
        story: { isDeleted: false },
      },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      include: { story: { include: { categories: true } } },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })) as UserStoryProgressWithStory[];
  }

  async findUserCompletedProgress(
    userId: string,
    opts?: ProgressPageOptions,
  ): Promise<UserStoryProgressWithStory[]> {
    return (await this.prisma.userStoryProgress.findMany({
      where: {
        userId,
        completed: true,
        isDeleted: false,
        story: { isDeleted: false },
      },
      orderBy: [{ lastAccessed: 'desc' }, { id: 'asc' }],
      include: { story: { include: { categories: true } } },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    })) as UserStoryProgressWithStory[];
  }

  async removeFromUserLibrary(
    userId: string,
    storyId: string,
  ): Promise<[Prisma.BatchPayload, Prisma.BatchPayload]> {
    return await this.prisma.$transaction([
      this.prisma.parentFavorite.deleteMany({ where: { userId, storyId } }),
      this.prisma.userStoryProgress.updateMany({
        where: { userId, storyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          progress: 0,
          completed: false,
        },
      }),
    ]);
  }
}
