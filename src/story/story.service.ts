import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateStoryDto,
  UpdateStoryDto,
  StoryImageDto,
  StoryBranchDto,
  FavoriteDto,
  StoryProgressDto,
  PaginatedStoriesDto,
  UserStoryProgressDto,
  StartStoryPathDto,
  UpdateStoryPathDto,
} from './dto/story.dto';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { StoryFavoriteService } from './story-favorite.service';
import { StoryDownloadService } from './story-download.service';
import { StoryProgressService } from './story-progress.service';
import { StoryPathService } from './story-path.service';
import { StoryMetadataService } from './story-metadata.service';
import { DailyChallengeService } from './daily-challenge.service';
import {
  IStoryCoreRepository,
  STORY_CORE_REPOSITORY,
} from './repositories/story-core.repository.interface';
import { CACHE_INVALIDATION } from '@/shared/constants/cache-keys.constants';
import { AppEvents, StoryCreatedEvent } from '@/shared/events';
import { VoiceType } from '../voice/dto/voice.dto';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);

  constructor(
    @Inject(STORY_CORE_REPOSITORY)
    private readonly storyRepository: IStoryCoreRepository,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly eventEmitter: EventEmitter2,
    private readonly favoriteService: StoryFavoriteService,
    private readonly downloadService: StoryDownloadService,
    private readonly progressService: StoryProgressService,
    private readonly pathService: StoryPathService,
    private readonly metadataService: StoryMetadataService,
    private readonly dailyChallengeService: DailyChallengeService,
  ) {}

  /** Invalidate story content caches (not metadata like categories/themes) */
  private async invalidateStoryCaches(): Promise<void> {
    try {
      await Promise.all(
        CACHE_INVALIDATION.STORY_CONTENT.map((key) =>
          this.cacheManager.del(key),
        ),
      );
    } catch (error) {
      this.logger.warn(`Failed to invalidate story caches: ${error.message}`);
    }
  }

  async getStories(filter: {
    theme?: string;
    category?: string;
    season?: string;
    recommended?: boolean;
    isMostLiked?: boolean;
    isSeasonal?: boolean;
    topPicksFromUs?: boolean;
    age?: number;
    minAge?: number;
    maxAge?: number;
    kidId?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedStoriesDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 10;
    const skip = (page - 1) * limit;

    // Build query
    const where: any = { isDeleted: false, isPublished: true };
    if (filter.theme) where.themes = { some: { name: filter.theme } };
    if (filter.category) where.categories = { some: { name: filter.category } };
    if (filter.season) where.seasons = { some: { name: filter.season } };
    if (filter.recommended) where.recommended = true;
    if (filter.age) {
      where.minAge = { lte: filter.age };
      where.maxAge = { gte: filter.age };
    }
    if (filter.minAge) where.minAge = { gte: filter.minAge };
    if (filter.maxAge) where.maxAge = { lte: filter.maxAge };

    // Seasonal filter: match stories linked to currently active seasons
    if (filter.isSeasonal) {
      const allSeasons = await this.metadataService.getSeasons();
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();
      const currentDateStr = `${currentMonth
        .toString()
        .padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;

      const activeSeasonIds = allSeasons
        .filter((s: any) => {
          if (!s.isActive || !s.startDate || !s.endDate) return false;
          if (s.startDate > s.endDate) {
            // Wraps across year boundary (e.g. Dec-Jan)
            return currentDateStr >= s.startDate || currentDateStr <= s.endDate;
          }
          return currentDateStr >= s.startDate && currentDateStr <= s.endDate;
        })
        .map((s: any) => s.id);

      if (activeSeasonIds.length > 0) {
        where.seasons = { some: { id: { in: activeSeasonIds } } };
      } else {
        // No active seasons; return empty result by using impossible filter
        where.seasons = { some: { id: 'non-existent-id' } };
      }
    }

    // Most-liked: order by parent favorites count descending
    const orderBy = filter.isMostLiked
      ? [
          { parentFavorites: { _count: 'desc' as const } },
          { createdAt: 'desc' as const },
          { id: 'asc' as const },
        ]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    const [stories, total] = await Promise.all([
      this.storyRepository.findStories({
        where,
        skip,
        take: limit,
        orderBy: orderBy as any,
        include: {
          images: true,
          categories: true,
          themes: true,
        },
        excludeContent: true, // Exclude textContent for list views
      }),
      this.storyRepository.countStories(where),
    ]);

    return {
      data: stories.map((story) => ({
        ...story,
        isLiked: false, // Would need kid context to determine
        isFavorite: false,
      })),
      pagination: {
        totalCount: total,
        currentPage: page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCreatedStories(kidId: string) {
    return this.storyRepository.findStories({
      where: { creatorKidId: kidId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { images: true },
      excludeContent: true,
    });
  }

  async getStoryById(id: string) {
    const story = await this.storyRepository.findStoryById(id);
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  async createStory(data: CreateStoryDto) {
    const story = await this.storyRepository.createStory(
      {
        title: data.title,
        description: data.description,
        textContent: data.textContent,
        // @ts-ignore - DTO might have mapped fields, ensuring basic fields match
        language: data.language || 'en',
        coverImageUrl: data.coverImageUrl || '',
        audioUrl: data.audioUrl || '',
        isInteractive: data.isInteractive || false,
        ageMin: data.ageMin ?? 0,
        ageMax: data.ageMax ?? 0,
        // difficultyLevel: data.readingLevel, // Removed as not in DTO or DB check required
        // isPublished: (data as any).isPublished ?? false, // Removed due to type error
        // durationSeconds: data.duration, // Not in DTO
        // creatorKid: data.creatorKidId // Not in DTO
        categories: data.categoryIds
          ? { connect: data.categoryIds.map((id) => ({ id })) }
          : undefined,
        themes: data.themeIds
          ? { connect: data.themeIds.map((id) => ({ id })) }
          : undefined,
      },
      { images: true },
    );

    this.eventEmitter.emit(AppEvents.STORY_CREATED, {
      storyId: story.id,
      title: story.title,
      creatorKidId: story.creatorKidId,
      aiGenerated: false, // Default since manual creation
      createdAt: story.createdAt,
    } as StoryCreatedEvent);
    await this.invalidateStoryCaches();

    return story;
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    // Map DTO to Prisma Update Input manually or spread if keys match
    // Simplified for this refactor
    const updateData: any = { ...data, updatedAt: new Date() };
    delete updateData.categories; // Handle relations separately if needed
    delete updateData.themes;

    const story = await this.storyRepository.updateStory(id, updateData, {
      images: true,
    });

    await this.invalidateStoryCaches();
    return story;
  }

  async deleteStory(id: string, permanent: boolean = false) {
    const story = permanent
      ? await this.storyRepository.deleteStoryPermanently(id)
      : await this.storyRepository.softDeleteStory(id);

    await this.invalidateStoryCaches();
    return story;
  }

  async undoDeleteStory(id: string) {
    const story = await this.storyRepository.restoreStory(id);
    await this.invalidateStoryCaches();
    return story;
  }

  async getStoryAudioUrl(
    storyId: string,
    voiceId: VoiceType | string,
    userId?: string,
  ): Promise<string> {
    const story = await this.storyRepository.findStoryById(storyId);
    if (!story) throw new NotFoundException('Story not found');

    return this.textToSpeechService.synthesizeStory(
      story.id,
      story.textContent || story.description || '', // Fallback to description if no text
      voiceId as VoiceType,
      userId,
    );
  }

  // ==================== Restriction Methods ====================

  async restrictStory(
    kidId: string,
    storyId: string,
    userId: string,
    reason?: string,
  ) {
    return await this.storyRepository.restrictStory(
      kidId,
      storyId,
      userId,
      reason,
    );
  }

  async unrestrictStory(kidId: string, storyId: string) {
    return await this.storyRepository.unrestrictStory(kidId, storyId);
  }

  async getRestrictedStories(kidId: string) {
    return await this.storyRepository.findRestrictedStories(kidId);
  }

  // ==================== Delegated Methods ====================

  /**
   * Favorites - Delegated to StoryFavoriteService
   */
  async addFavorite(dto: FavoriteDto) {
    return this.favoriteService.addFavorite(dto);
  }

  async removeFavorite(kidId: string, storyId: string) {
    return this.favoriteService.removeFavorite(kidId, storyId);
  }

  async getFavorites(kidId: string) {
    return this.favoriteService.getFavorites(kidId);
  }

  /**
   * Downloads - Delegated to StoryDownloadService
   */
  async getDownloads(kidId: string) {
    return this.downloadService.getDownloads(kidId);
  }

  async addDownload(kidId: string, storyId: string) {
    return this.downloadService.addDownload(kidId, storyId);
  }

  async removeDownload(kidId: string, storyId: string) {
    return this.downloadService.removeDownload(kidId, storyId);
  }

  /**
   * Progress - Delegated to StoryProgressService
   */
  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    return this.progressService.setProgress(dto);
  }

  async getProgress(kidId: string, storyId: string) {
    return this.progressService.getProgress(kidId, storyId);
  }

  async getCompletedStories(kidId: string) {
    return this.progressService.getCompletedStories(kidId);
  }

  async getContinueReading(kidId: string) {
    return this.progressService.getContinueReading(kidId);
  }

  /**
   * User Progress - Delegated to StoryProgressService
   */
  async setUserProgress(userId: string, dto: UserStoryProgressDto) {
    return this.progressService.setUserProgress(userId, dto);
  }

  async getUserProgress(userId: string, storyId: string) {
    return this.progressService.getUserProgress(userId, storyId);
  }

  async getUserContinueReading(userId: string) {
    return this.progressService.getUserContinueReading(userId);
  }

  async getUserCompletedStories(userId: string) {
    return this.progressService.getUserCompletedStories(userId);
  }

  async removeFromUserLibrary(userId: string, storyId: string) {
    return this.progressService.removeFromUserLibrary(userId, storyId);
  }

  /**
   * Library Management - Coordinator Method
   */
  async removeFromLibrary(kidId: string, storyId: string) {
    await Promise.all([
      this.favoriteService.removeFavorite(kidId, storyId),
      this.downloadService.deleteDownloadsForStory(kidId, storyId),
      this.progressService.deleteStoryProgress(kidId, storyId),
    ]);
    return { success: true };
  }

  /**
   * Metadata - Delegated to StoryMetadataService
   */
  async getCategories() {
    return this.metadataService.getCategories();
  }

  async getThemes() {
    return this.metadataService.getThemes();
  }

  async getSeasons() {
    return this.metadataService.getSeasons();
  }

  async addImage(storyId: string, image: StoryImageDto) {
    return this.metadataService.addImage(storyId, image);
  }

  async addBranch(storyId: string, branch: StoryBranchDto) {
    return this.metadataService.addBranch(storyId, branch);
  }

  /**
   * Paths - Delegated to StoryPathService
   */
  async startStoryPath(dto: StartStoryPathDto) {
    return this.pathService.startStoryPath(dto);
  }

  async updateStoryPath(id: string, dto: UpdateStoryPathDto) {
    return this.pathService.updateStoryPath(id, dto);
  }

  async getStoryPathsForKid(kidId: string) {
    return this.pathService.getStoryPaths(kidId);
  }

  async getStoryPathById(pathId: string) {
    return this.pathService.getStoryPathById(pathId);
  }
}
