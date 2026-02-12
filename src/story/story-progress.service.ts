import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  StoryProgressDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  StoryCompletedEvent,
  StoryProgressUpdatedEvent,
} from '@/shared/events';
import {
  IStoryProgressRepository,
  STORY_PROGRESS_REPOSITORY,
} from './repositories/story-progress.repository.interface';

@Injectable()
export class StoryProgressService {
  private readonly logger = new Logger(StoryProgressService.name);

  constructor(
    @Inject(STORY_PROGRESS_REPOSITORY)
    private readonly progressRepository: IStoryProgressRepository,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * Set progress for a kid's story session
   */
  async setProgress(
    dto: StoryProgressDto & { sessionTime?: number },
  ) {
    const { kidId, storyId, progress, completed } = dto;

    const existingProgress = await this.progressRepository.findStoryProgress(
      kidId,
      storyId,
    );

    // Calculate total time spent
    let totalTimeSpent = existingProgress?.totalTimeSpent || 0;
    if (dto.sessionTime && dto.sessionTime > 0) {
      totalTimeSpent += dto.sessionTime;
    }

    const updatedProgress = await this.progressRepository.upsertStoryProgress(
      kidId,
      storyId,
      {
        progress,
        completed: completed || false,
        totalTimeSpent,
      },
    );

    // Emit progress event
    this.eventEmitter.emit(
      AppEvents.STORY_PROGRESS_UPDATED,
      AppEvents.STORY_PROGRESS_UPDATED,
      {
        kidId,
        storyId,
        progress: updatedProgress.progress,
        sessionTime: dto.sessionTime || 0,
        totalTimeSpent,
        updatedAt: new Date(),
      } as StoryProgressUpdatedEvent,
    );

    // Initial completion check
    if (completed && (!existingProgress || !existingProgress.completed)) {
      this.logger.log(`Story ${storyId} completed by kid ${kidId}`);

      this.eventEmitter.emit(
        AppEvents.STORY_COMPLETED,
        AppEvents.STORY_COMPLETED,
        {
          kidId,
          storyId,
          completedAt: new Date(),
          totalTimeSpent,
        } as StoryCompletedEvent,
      );

      // Adjust reading level logic would ideally be moved to a listener or separate service
      // But keeping placeholder logic if needed here or delegated
    }

    return updatedProgress;
  }

  async getProgress(kidId: string, storyId: string) {
    const progress = await this.progressRepository.findStoryProgress(kidId, storyId);
    return progress || { progress: 0, completed: false };
  }

  async getContinueReading(kidId: string) {
    const records = await this.progressRepository.findContinueReadingProgress(kidId);
    return records.map((r) => r.story);
  }

  async deleteStoryProgress(kidId: string, storyId: string) {
    return await this.progressRepository.deleteStoryProgress(kidId, storyId);
  }

  async getCompletedStories(kidId: string) {
    const records = await this.progressRepository.findCompletedProgress(kidId);
    return records.map((r) => r.story);
  }

  // ==================== User (Adult) Progress ====================

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    const { storyId, progress, completed } = dto;

    // Calculate total time (simplified for user progress compared to kid)
    // Could fetch existing to increment time if we tracked it similarly

    const updated = await this.progressRepository.upsertUserStoryProgress(
      userId,
      storyId,
      {
        progress,
        completed: completed || false,
        totalTimeSpent: 0, // Placeholder if not tracked in DTO
      },
    );

    return {
      id: updated.id,
      userId: updated.userId,
      storyId: updated.storyId,
      progress: updated.progress,
      completed: updated.completed,
      lastAccessed: updated.lastAccessed,
      totalTimeSpent: 0,
    };
  }

  async getUserProgress(
    userId: string,
    storyId: string,
  ): Promise<UserStoryProgressResponseDto | null> {
    const progress = await this.progressRepository.findUserStoryProgress(
      userId,
      storyId,
    );

    if (!progress) return null;

    return {
      id: progress.id,
      userId: progress.userId,
      storyId: progress.storyId,
      progress: progress.progress,
      completed: progress.completed,
      lastAccessed: progress.lastAccessed,
      totalTimeSpent: 0, // Placeholder
    };
  }

  async getUserContinueReading(userId: string) {
    const records = await this.progressRepository.findUserContinueReadingProgress(
      userId,
    );

    return records.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  async getUserCompletedStories(userId: string) {
    const records = await this.progressRepository.findUserCompletedProgress(
      userId,
    );
    return records.map((r) => r.story);
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    await this.progressRepository.deleteUserStoryProgress(userId, storyId);
    return { success: true };
  }
}
