import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  StoryProgressDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';
import { STORY_REPOSITORY, IStoryRepository } from './repositories';

@Injectable()
export class StoryProgressService {
  private readonly logger = new Logger(StoryProgressService.name);

  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
  ) {}

  // =====================
  // KID STORY PROGRESS
  // =====================

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    // Batch validation queries
    const [kid, story] = await Promise.all([
      this.storyRepository.findKidById(dto.kidId),
      this.storyRepository.findStoryById(dto.storyId),
    ]);
    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.storyRepository.findStoryProgress(
      dto.kidId,
      dto.storyId,
    );

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.storyRepository.upsertStoryProgress(
      dto.kidId,
      dto.storyId,
      {
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: newTotalTime,
      },
    );

    if (dto.completed && (!existing || !existing.completed)) {
      this.adjustReadingLevel(dto.kidId, dto.storyId, newTotalTime).catch((e) =>
        this.logger.error(`Failed to adjust reading level: ${e.message}`),
      );
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    // Batch validation queries
    const [kid, story] = await Promise.all([
      this.storyRepository.findKidById(kidId),
      this.storyRepository.findStoryById(storyId),
    ]);
    if (!kid) throw new NotFoundException('Kid not found');
    if (!story) throw new NotFoundException('Story not found');
    return await this.storyRepository.findStoryProgress(kidId, storyId);
  }

  async getContinueReading(kidId: string) {
    const progressRecords =
      await this.storyRepository.findContinueReadingProgress(kidId);
    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getCompletedStories(kidId: string) {
    const records = await this.storyRepository.findCompletedProgress(kidId);
    return records.map((r) => r.story);
  }

  async getCreatedStories(kidId: string) {
    return await this.storyRepository.findStories({
      where: { creatorKidId: kidId, isDeleted: false },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  // =====================
  // USER STORY PROGRESS (Parent/User - non-kid specific)
  // =====================

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    // Batch validation queries
    const [user, story] = await Promise.all([
      this.storyRepository.findUserById(userId),
      this.storyRepository.findStoryById(dto.storyId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.storyRepository.findUserStoryProgress(
      userId,
      dto.storyId,
    );

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.storyRepository.upsertUserStoryProgress(
      userId,
      dto.storyId,
      {
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: newTotalTime,
      },
    );

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
    // Batch validation queries
    const [user, story] = await Promise.all([
      this.storyRepository.findUserById(userId),
      this.storyRepository.findStoryById(storyId),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!story) throw new NotFoundException('Story not found');

    const progress = await this.storyRepository.findUserStoryProgress(
      userId,
      storyId,
    );

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
    const progressRecords =
      await this.storyRepository.findUserContinueReadingProgress(userId);

    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getUserCompletedStories(userId: string) {
    const records =
      await this.storyRepository.findUserCompletedProgress(userId);
    return records.map((r) => r.story);
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    // Execute deletions in parallel - repository handles individual operations
    await Promise.all([
      this.storyRepository.deleteParentFavorites(userId, storyId),
      this.storyRepository.deleteUserStoryProgress(userId, storyId),
    ]);
    return { message: 'Removed from library' };
  }

  // =====================
  // DOWNLOADS
  // =====================

  async getDownloads(kidId: string) {
    const downloads = await this.storyRepository.findDownloadsByKidId(kidId);
    return downloads.map((d) => d.story);
  }

  async addDownload(kidId: string, storyId: string) {
    const story = await this.storyRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.storyRepository.upsertDownload(kidId, storyId);
  }

  async removeDownload(kidId: string, storyId: string) {
    const result = await this.storyRepository.deleteDownload(kidId, storyId);
    return result ?? { message: 'Download removed' };
  }

  // =====================
  // LIBRARY MANAGEMENT
  // =====================

  async removeFromLibrary(kidId: string, storyId: string) {
    // Execute deletions in parallel - repository handles individual operations
    await Promise.all([
      this.storyRepository.deleteFavorites(kidId, storyId),
      this.storyRepository.deleteDownloads(kidId, storyId),
      this.storyRepository.deleteStoryProgress(kidId, storyId),
    ]);
    return { message: 'Removed from library' };
  }

  // =====================
  // PRIVATE HELPERS
  // =====================

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    // Batch queries for story and kid
    const [story, kid] = await Promise.all([
      this.storyRepository.findStoryById(storyId),
      this.storyRepository.findKidById(kidId),
    ]);
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
      await this.storyRepository.updateKidReadingLevel(kidId, newLevel);
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }
}
