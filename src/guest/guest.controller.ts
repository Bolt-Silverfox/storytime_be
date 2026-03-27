import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  BadRequestException,
  NotFoundException,
  Logger,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { OptionalAuth } from '@/shared/decorators/optional-auth.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { GuestSessionService } from './guest-session.service';
import { PrismaService } from '@/prisma/prisma.service';

interface UpdateProgressDto {
  storyId: string;
  progress: number;
}

interface ProgressResponse {
  storyId: string;
  progress: number;
  lastAccessed: Date;
}

interface HistoryResponse {
  stories: Array<{
    storyId: string;
    progress: number;
    lastAccessed: Date;
  }>;
}

@ApiTags('Guest')
@Controller('guest')
export class GuestController {
  private readonly logger = new Logger(GuestController.name);

  constructor(
    private readonly guestSessionService: GuestSessionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Update reading progress for a story
   * Works for both guests (via X-Guest-Session-Id header) and authenticated users
   */
  @Post('progress')
  @OptionalAuth()
  @ApiOperation({ summary: 'Update reading progress for a story' })
  @ApiHeader({
    name: 'X-Guest-Session-Id',
    description: 'Guest session ID (required for unauthenticated users)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Progress updated successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request - missing guest session ID for unauthenticated users',
  })
  async updateProgress(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProgressDto,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<{ success: boolean }> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or X-Guest-Session-Id header is required',
      );
    }

    // Clamp progress between 0 and 100
    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    if (userId) {
      // Authenticated user - update in database
      await this.prisma.userStoryProgress.upsert({
        where: {
          userId_storyId: { userId, storyId: dto.storyId },
        },
        update: {
          progress: clampedProgress,
          lastAccessed: new Date(),
        },
        create: {
          userId,
          storyId: dto.storyId,
          progress: clampedProgress,
          lastAccessed: new Date(),
        },
      });
    } else if (guestSessionId) {
      // Guest user - update in Redis
      await this.guestSessionService.updateGuestProgress(
        guestSessionId,
        dto.storyId,
        clampedProgress,
      );
    }

    return { success: true };
  }

  /**
   * Get reading progress for a specific story
   * Works for both guests and authenticated users
   */
  @Get('progress/:storyId')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get reading progress for a specific story' })
  @ApiHeader({
    name: 'X-Guest-Session-Id',
    description: 'Guest session ID (required for unauthenticated users)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Progress retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - no progress found',
  })
  async getProgress(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<ProgressResponse | null> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or X-Guest-Session-Id header is required',
      );
    }

    if (userId) {
      // Authenticated user - get from database
      const progress = await this.prisma.userStoryProgress.findUnique({
        where: {
          userId_storyId: { userId, storyId },
        },
        select: {
          storyId: true,
          progress: true,
          lastAccessed: true,
        },
      });

      if (!progress) {
        return null;
      }

      return {
        storyId: progress.storyId,
        progress: progress.progress,
        lastAccessed: progress.lastAccessed,
      };
    } else if (guestSessionId) {
      // Guest user - get from Redis
      const session =
        await this.guestSessionService.getGuestSession(guestSessionId);

      if (!session) {
        throw new NotFoundException('Guest session not found');
      }

      const storyProgress = session.readingHistory[storyId];

      if (!storyProgress) {
        return null;
      }

      return {
        storyId,
        progress: storyProgress.progress,
        lastAccessed: storyProgress.lastReadAt,
      };
    }

    return null;
  }

  /**
   * Get reading history
   * Works for both guests and authenticated users
   */
  @Get('history')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get reading history' })
  @ApiHeader({
    name: 'X-Guest-Session-Id',
    description: 'Guest session ID (required for unauthenticated users)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'History retrieved successfully',
  })
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<HistoryResponse> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or X-Guest-Session-Id header is required',
      );
    }

    if (userId) {
      // Authenticated user - get from database
      const progressRecords = await this.prisma.userStoryProgress.findMany({
        where: { userId },
        select: {
          storyId: true,
          progress: true,
          lastAccessed: true,
        },
        orderBy: { lastAccessed: 'desc' },
      });

      return {
        stories: progressRecords.map((record) => ({
          storyId: record.storyId,
          progress: record.progress,
          lastAccessed: record.lastAccessed,
        })),
      };
    } else if (guestSessionId) {
      // Guest user - get from Redis
      const session =
        await this.guestSessionService.getGuestSession(guestSessionId);

      if (!session) {
        throw new NotFoundException('Guest session not found');
      }

      const history =
        await this.guestSessionService.getGuestReadingHistory(guestSessionId);

      if (!history) {
        return { stories: [] };
      }

      // Convert Record to array
      const historyArray = Object.entries(history).map(
        ([storyId, progress]) => ({
          storyId,
          progress: progress.progress,
          lastAccessed: progress.lastReadAt,
        }),
      );

      return {
        stories: historyArray,
      };
    }

    return { stories: [] };
  }
}
