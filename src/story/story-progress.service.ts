import {
  Injectable,
  Logger,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  StoryProgressDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';
import {
  IStoryProgressRepository,
  STORY_PROGRESS_REPOSITORY,
  StoryProgressWithStory,
  UserStoryProgressWithStory,
} from './repositories/story-progress.repository.interface';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';

/** Max session time in seconds (24 h), matching the DTO contract. */
const MAX_SESSION_TIME = 86_400;

/** Parse, clamp and floor a raw sessionTime value to a safe integer in [0, MAX_SESSION_TIME]. */
function normalizeSessionTime(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw)
    ? Math.min(Math.max(0, Math.floor(raw)), MAX_SESSION_TIME)
    : 0;
}

@Injectable()
export class StoryProgressService {
  private readonly logger = new Logger(StoryProgressService.name);

  constructor(
    @Inject(STORY_PROGRESS_REPOSITORY)
    private readonly progressRepository: IStoryProgressRepository,
  ) {}

  /** Wraps a query to handle invalid cursor IDs gracefully */
  private async withCursorErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new BadRequestException('Invalid cursor: record not found');
      }
      throw error;
    }
  }

  private mapProgressRecord(
    record: StoryProgressWithStory | UserStoryProgressWithStory,
  ) {
    return {
      ...record.story,
      progressId: record.id,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    };
  }

  // ==================== KID PROGRESS ====================

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    const kid = await this.progressRepository.findKidById(dto.kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.progressRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');

    const sessionTime = normalizeSessionTime(dto.sessionTime);
    // Clamp incoming progress to a valid [0, 100] percentage.
    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    const existing = await this.progressRepository.findStoryProgress(
      dto.kidId,
      dto.storyId,
    );

    // Completion is monotonic and auto-derived (mirrors the guest path): once a
    // story is completed it stays completed, and reaching 100% marks it done
    // even without an explicit flag — so a later partial-progress ping can no
    // longer silently un-complete the story.
    const shouldComplete =
      existing?.completed === true ||
      dto.completed === true ||
      clampedProgress >= 100;

    const result = await this.progressRepository.upsertKidProgress(
      dto.kidId,
      dto.storyId,
      {
        progress: clampedProgress,
        completed: shouldComplete,
        sessionTime,
      },
    );

    // Fire the (non-idempotent) reading-level adjustment only on the transition
    // from not-completed to completed, now including the auto-derived 100% case.
    if (shouldComplete && !existing?.completed) {
      this.adjustReadingLevel(
        dto.kidId,
        dto.storyId,
        result.totalTimeSpent,
      ).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Failed to adjust reading level: ${msg}`);
      });
    }
    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    const kid = await this.progressRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.progressRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.progressRepository.findStoryProgress(kidId, storyId);
  }

  async getContinueReading(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const progressRecords = await this.withCursorErrorHandling(() =>
      this.progressRepository.findContinueReadingProgress(kidId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: progressRecords.map((r) => this.mapProgressRecord(r)),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      progressRecords,
      take,
    );
    return { data: data.map((r) => this.mapProgressRecord(r)), pagination };
  }

  async getCompletedStories(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records = await this.withCursorErrorHandling(() =>
      this.progressRepository.findCompletedProgress(kidId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: records.map((r) => r.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      records,
      take,
    );
    return { data: data.map((r) => r.story), pagination };
  }

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    const story = await this.progressRepository.findStoryById(storyId);
    const kid = await this.progressRepository.findKidById(kidId);
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
      await this.progressRepository.updateKidReadingLevel(kidId, newLevel);
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }

  // ==================== USER (PARENT) PROGRESS ====================

  async setUserProgress(
    userId: string,
    dto: UserStoryProgressDto,
  ): Promise<UserStoryProgressResponseDto> {
    const user = await this.progressRepository.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    const story = await this.progressRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');

    const existing = await this.progressRepository.findUserStoryProgress(
      userId,
      dto.storyId,
    );

    const sessionTime = normalizeSessionTime(dto.sessionTime);
    // Clamp incoming progress to a valid [0, 100] percentage.
    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    // If restoring a soft-deleted record, reset totalTimeSpent instead of
    // accumulating stale time from before the removal.
    const totalTimeSpentUpdate = existing?.isDeleted
      ? sessionTime
      : { increment: sessionTime };

    // Completion is monotonic and auto-derived at 100% (mirrors the guest path):
    // once completed the story stays completed until removeFromUserLibrary
    // resets it, so a later partial-progress ping can no longer un-complete it.
    const shouldComplete =
      existing?.completed === true ||
      dto.completed === true ||
      clampedProgress >= 100;

    const result = await this.progressRepository.upsertUserProgress(
      userId,
      dto.storyId,
      {
        progress: clampedProgress,
        completed: shouldComplete,
        createTotalTimeSpent: sessionTime,
        updateTotalTimeSpent: totalTimeSpentUpdate,
      },
    );

    return {
      id: result.id,
      userId: result.userId,
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
    const user = await this.progressRepository.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');
    const story = await this.progressRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');

    const progress = await this.progressRepository.findActiveUserStoryProgress(
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
      totalTimeSpent: progress.totalTimeSpent,
    };
  }

  async getUserContinueReading(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const progressRecords = await this.withCursorErrorHandling(() =>
      this.progressRepository.findUserContinueReadingProgress(userId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: progressRecords.map((r) => this.mapProgressRecord(r)),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      progressRecords,
      take,
    );
    return { data: data.map((r) => this.mapProgressRecord(r)), pagination };
  }

  async getUserCompletedStories(
    userId: string,
    cursor?: string,
    limit?: number,
  ) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records = await this.withCursorErrorHandling(() =>
      this.progressRepository.findUserCompletedProgress(userId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: records.map((r) => r.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      records,
      take,
    );
    return { data: data.map((r) => r.story), pagination };
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return await this.progressRepository.removeFromUserLibrary(userId, storyId);
  }
}
