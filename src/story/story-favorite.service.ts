import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Prisma, Favorite } from '@prisma/client';
import { FavoriteDto } from './dto/story.dto';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';
import {
  IStoryFavoriteRepository,
  STORY_FAVORITE_REPOSITORY,
  FavoriteWithStory,
} from './repositories/story-favorite.repository.interface';

@Injectable()
export class StoryFavoriteService {
  constructor(
    @Inject(STORY_FAVORITE_REPOSITORY)
    private readonly favoriteRepository: IStoryFavoriteRepository,
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

  async addFavorite(dto: FavoriteDto): Promise<Favorite> {
    const kid = await this.favoriteRepository.findKidById(dto.kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const story = await this.favoriteRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.favoriteRepository.createFavorite(dto.kidId, dto.storyId);
  }

  async removeFavorite(
    kidId: string,
    storyId: string,
  ): Promise<{ count: number }> {
    return await this.favoriteRepository.deleteFavorites(kidId, storyId);
  }

  async getFavorites(kidId: string, cursor?: string, limit?: number) {
    const kid = await this.favoriteRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const records: FavoriteWithStory[] = await this.withCursorErrorHandling(() =>
      this.favoriteRepository.findFavoritesByKidId(kidId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: records,
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    return PaginationUtil.buildCursorResponse(records, take);
  }
}
