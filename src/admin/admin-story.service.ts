import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma, Story } from '@prisma/client';
import {
  IAdminStoryRepository,
  ADMIN_STORY_REPOSITORY,
} from './repositories';
import {
  PaginatedResponseDto,
  StoryListItemDto,
  StoryDetailDto,
  CategoryDto,
  ThemeDto,
} from './dto/admin-responses.dto';
import { StoryFilterDto } from './dto/admin-filters.dto';
import {
  CACHE_KEYS,
  STORY_INVALIDATION_KEYS,
} from '@/shared/constants/cache-keys.constants';

@Injectable()
export class AdminStoryService {
  private readonly logger = new Logger(AdminStoryService.name);

  constructor(
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly adminStoryRepository: IAdminStoryRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getAllStories(
    filters: StoryFilterDto,
  ): Promise<PaginatedResponseDto<StoryListItemDto>> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      recommended,
      aiGenerated,
      isDeleted,
      language,
      minAge,
      maxAge,
    } = filters;

    const skip = (page - 1) * limit;

    const where: Prisma.StoryWhereInput = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (typeof recommended === 'boolean') where.recommended = recommended;
    if (typeof aiGenerated === 'boolean') where.aiGenerated = aiGenerated;
    if (typeof isDeleted === 'boolean') where.isDeleted = isDeleted;
    if (language) where.language = language;
    if (minAge) where.ageMin = { gte: minAge };
    if (maxAge) where.ageMax = { lte: maxAge };

    const [stories, total] = await Promise.all([
      this.adminStoryRepository.findStories({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.adminStoryRepository.countStories(where),
    ]);

    return {
      data: stories.map((story) => {
        const { _count, ...storyData } = story;
        return {
          ...storyData,
          favoritesCount: _count.favorites,
          viewsCount: _count.progresses,
          parentFavoritesCount: _count.parentFavorites,
          downloadsCount: _count.downloads,
        };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStoryById(storyId: string): Promise<StoryDetailDto> {
    const story = await this.adminStoryRepository.findStoryById(storyId);

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    const { _count, ...storyData } = story;
    return {
      ...storyData,
      stats: {
        favoritesCount: _count.favorites,
        viewsCount: _count.progresses,
        parentFavoritesCount: _count.parentFavorites,
        downloadsCount: _count.downloads,
      },
    };
  }

  async toggleStoryRecommendation(storyId: string): Promise<Story> {
    const storyExists = await this.adminStoryRepository.storyExists(storyId);

    if (!storyExists) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    // Need to get current story to toggle its recommendation status
    const story = await this.adminStoryRepository.findStoryById(storyId);
    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    const result = await this.adminStoryRepository.updateStoryRecommendation({
      storyId,
      recommended: !story.recommended,
    });

    // Invalidate story stats cache for immediate dashboard accuracy
    try {
      await this.cacheManager.del(CACHE_KEYS.STORY_STATS);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate story stats cache: ${error.message}`,
      );
    }

    return result;
  }

  async deleteStory(
    storyId: string,
    permanent: boolean = false,
  ): Promise<Story> {
    const storyExists = await this.adminStoryRepository.storyExists(storyId);

    if (!storyExists) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    let result;
    if (permanent) {
      result = await this.adminStoryRepository.hardDeleteStory(storyId);
    } else {
      result = await this.adminStoryRepository.softDeleteStory(storyId);
    }

    // Invalidate dashboard caches for immediate accuracy
    try {
      await Promise.all(
        STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate dashboard caches: ${error.message}`,
      );
    }

    return result;
  }

  async getCategories(): Promise<CategoryDto[]> {
    const categories = await this.adminStoryRepository.findCategories();

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      image: cat.image || undefined,
      description: cat.description || undefined,
      isDeleted: cat.isDeleted,
      deletedAt: cat.deletedAt || undefined,
      _count: {
        stories: cat._count.stories,
        preferredByKids: cat._count.preferredByKids,
      },
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.adminStoryRepository.findThemes();

    return themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      image: theme.image || undefined,
      description: theme.description || undefined,
      isDeleted: theme.isDeleted,
      deletedAt: theme.deletedAt || undefined,
      _count: {
        stories: theme._count.stories,
      },
    }));
  }
}
