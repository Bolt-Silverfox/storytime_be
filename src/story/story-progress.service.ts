import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StoryProgressDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';

@Injectable()
export class StoryProgressService {
  private readonly logger = new Logger(StoryProgressService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =====================
  // KID STORY PROGRESS
  // =====================

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
    });

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
        totalTimeSpent: newTotalTime,
      },
      create: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: sessionTime,
      },
    });

    if (dto.completed && (!existing || !existing.completed)) {
      this.adjustReadingLevel(dto.kidId, dto.storyId, newTotalTime).catch((e) =>
        this.logger.error(`Failed to adjust reading level: ${e.message}`),
      );
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  async getContinueReading(kidId: string) {
    const progressRecords = await this.prisma.storyProgress.findMany({
      where: { kidId, progress: { gt: 0 }, completed: false, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });
    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getCompletedStories(kidId: string) {
    const records = await this.prisma.storyProgress.findMany({
      where: { kidId, completed: true, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });
    return records.map((r) => r.story);
  }

  async getCreatedStories(kidId: string) {
    return await this.prisma.story.findMany({
      where: { creatorKidId: kidId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  // =====================
  // USER STORY PROGRESS (Parent/User - non-kid specific)
  // =====================

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
    });

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.prisma.userStoryProgress.upsert({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
        totalTimeSpent: newTotalTime,
      },
      create: {
        userId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: sessionTime,
      },
    });

    return {
      id: result.id,
      storyId: result.storyId,
      progress: result.progress,
      completed: result.completed,
      lastAccessed: result.lastAccessed,
      totalTimeSpent: result.totalTimeSpent,
    };
  }

  async getUserProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgressResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });
    if (!user) throw new NotFoundException('User not found');
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');

    const progress = await this.prisma.userStoryProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
    });

    if (!progress) return null;

    return {
      id: progress.id,
      storyId: progress.storyId,
      progress: progress.progress,
      completed: progress.completed,
      lastAccessed: progress.lastAccessed,
      totalTimeSpent: progress.totalTimeSpent,
    };
  }

  async getUserContinueReading(userId: string) {
    const progressRecords = await this.prisma.userStoryProgress.findMany({
      where: {
        userId,
        progress: { gt: 0 },
        completed: false,
        isDeleted: false,
      },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });

    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getUserCompletedStories(userId: string) {
    const records = await this.prisma.userStoryProgress.findMany({
      where: { userId, completed: true, isDeleted: false },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });

    return records.map((r) => r.story);
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return await this.prisma.$transaction([
      this.prisma.parentFavorite.deleteMany({ where: { userId, storyId } }),
      this.prisma.userStoryProgress.deleteMany({ where: { userId, storyId } }),
    ]);
  }

  // =====================
  // DOWNLOADS
  // =====================

  async getDownloads(kidId: string) {
    const downloads = await this.prisma.downloadedStory.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { downloadedAt: 'desc' },
    });
    return downloads.map((d) => d.story);
  }

  async addDownload(kidId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.downloadedStory.upsert({
      where: { kidId_storyId: { kidId, storyId } },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  async removeDownload(kidId: string, storyId: string) {
    try {
      return await this.prisma.downloadedStory.delete({
        where: { kidId_storyId: { kidId, storyId } },
      });
    } catch {
      return { message: 'Download removed' };
    }
  }

  // =====================
  // LIBRARY MANAGEMENT
  // =====================

  async removeFromLibrary(kidId: string, storyId: string) {
    return await this.prisma.$transaction([
      this.prisma.favorite.deleteMany({ where: { kidId, storyId } }),
      this.prisma.downloadedStory.deleteMany({ where: { kidId, storyId } }),
      this.prisma.storyProgress.deleteMany({ where: { kidId, storyId } }),
    ]);
  }

  // =====================
  // PRIVATE HELPERS
  // =====================

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId, isDeleted: false },
    });
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!story || !kid || story.wordCount === 0) return;
    const minutes = totalTimeSeconds / 60;
    const wpm = minutes > 0 ? story.wordCount / minutes : 0;
    let newLevel = kid.currentReadingLevel;
    if (wpm > 120 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.min(10, kid.currentReadingLevel + 1);
    } else if (wpm < 40 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.max(1, kid.currentReadingLevel - 1);
    }
    if (newLevel !== kid.currentReadingLevel) {
      await this.prisma.kid.update({
        where: { id: kidId },
        data: { currentReadingLevel: newLevel },
      });
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }
}
