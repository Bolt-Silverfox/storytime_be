import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IStoryProgressRepository } from './story-progress.repository.interface';
import type { StoryProgress } from '@prisma/client';

@Injectable()
export class PrismaStoryProgressRepository implements IStoryProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCompletedInRange(
    kidId: string,
    gte: Date,
    lt: Date,
  ): Promise<number> {
    return this.prisma.storyProgress.count({
      where: {
        kidId,
        completed: true,
        lastAccessed: {
          gte,
          lt,
        },
      },
    });
  }

  async countCompletedSince(kidId: string, gte: Date): Promise<number> {
    return this.prisma.storyProgress.count({
      where: {
        kidId,
        completed: true,
        lastAccessed: { gte },
      },
    });
  }

  async countInProgress(kidId: string): Promise<number> {
    return this.prisma.storyProgress.count({
      where: {
        kidId,
        completed: false,
      },
    });
  }

  async upsertCompletedProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress> {
    return this.prisma.storyProgress.upsert({
      where: {
        kidId_storyId: {
          kidId,
          storyId,
        },
      },
      update: {
        completed: true,
        progress: 100,
        lastAccessed: new Date(),
      },
      create: {
        kidId,
        storyId,
        completed: true,
        progress: 100,
        lastAccessed: new Date(),
      },
    });
  }
}
