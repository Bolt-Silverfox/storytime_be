import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  GUEST_STORY_DETAIL_SELECT,
  type GuestStoryDetail,
  type GuestUserHistoryRow,
  type GuestUserProgressRow,
  type IGuestRepository,
} from './guest.repository.interface';

@Injectable()
export class PrismaGuestRepository implements IGuestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertUserStoryProgress(
    userId: string,
    storyId: string,
    progress: number,
    markCompleted: boolean,
  ): Promise<void> {
    await this.prisma.userStoryProgress.upsert({
      where: {
        userId_storyId: { userId, storyId },
      },
      update: {
        progress,
        ...(markCompleted ? { completed: true } : {}),
        lastAccessed: new Date(),
        isDeleted: false,
      },
      create: {
        userId,
        storyId,
        progress,
        completed: markCompleted,
        lastAccessed: new Date(),
      },
    });
  }

  async findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<GuestUserProgressRow | null> {
    return this.prisma.userStoryProgress.findFirst({
      where: {
        userId,
        storyId,
        isDeleted: false,
      },
      select: {
        progress: true,
        lastAccessed: true,
        completed: true,
      },
    });
  }

  async findStoryDetail(storyId: string): Promise<GuestStoryDetail | null> {
    return this.prisma.story.findFirst({
      where: { id: storyId, isDeleted: false },
      select: GUEST_STORY_DETAIL_SELECT,
    });
  }

  async findUserReadingHistory(userId: string): Promise<GuestUserHistoryRow[]> {
    return this.prisma.userStoryProgress.findMany({
      where: { userId, isDeleted: false },
      select: {
        storyId: true,
        progress: true,
        completed: true,
        lastAccessed: true,
        story: {
          select: GUEST_STORY_DETAIL_SELECT,
        },
      },
      orderBy: { lastAccessed: 'desc' },
    });
  }

  async findStoryDetailsByIds(storyIds: string[]): Promise<GuestStoryDetail[]> {
    return this.prisma.story.findMany({
      where: {
        id: { in: storyIds },
        isDeleted: false,
      },
      select: GUEST_STORY_DETAIL_SELECT,
    });
  }

  async createGuestActivityLog(data: {
    action: string;
    status: string;
    details: string;
  }): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        action: data.action,
        status: data.status,
        details: data.details,
      },
    });
  }
}
