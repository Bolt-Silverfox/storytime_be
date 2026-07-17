import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IStoryDownloadRepository,
  STORY_DOWNLOAD_REPOSITORY,
} from './repositories/story-download.repository.interface';
import {
  DEFAULT_CURSOR_LIMIT,
  PaginationUtil,
} from '@/shared/utils/pagination.util';

@Injectable()
export class StoryDownloadService {
  constructor(
    @Inject(STORY_DOWNLOAD_REPOSITORY)
    private readonly downloadRepository: IStoryDownloadRepository,
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

  async getDownloads(kidId: string, cursor?: string, limit?: number) {
    const useCursor = cursor !== undefined || limit !== undefined;
    const take = limit ?? DEFAULT_CURSOR_LIMIT;

    const downloads = await this.withCursorErrorHandling(() =>
      this.downloadRepository.findDownloadsByKidId(kidId, {
        take: useCursor ? take + 1 : undefined,
        cursor,
      }),
    );

    if (!useCursor) {
      return {
        data: downloads.map((d) => d.story),
        pagination: { nextCursor: null, hasNextPage: false },
      };
    }

    const { data, pagination } = PaginationUtil.buildCursorResponse(
      downloads,
      take,
    );
    return { data: data.map((d) => d.story), pagination };
  }

  async removeDownload(kidId: string, storyId: string) {
    const result = await this.downloadRepository.deleteDownload(kidId, storyId);
    return result || { message: 'Download removed' };
  }
}
