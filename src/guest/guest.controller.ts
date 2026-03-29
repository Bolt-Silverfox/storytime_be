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
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalAuth } from '@/shared/decorators/optional-auth.decorator';
import { Public } from '@/shared/decorators/public.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import {
  GuestSessionService,
  GUEST_SESSION_TTL_SECONDS,
} from './guest-session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StoryService } from '@/story/story.service';
import {
  UpdateGuestProgressDto,
  CreateGuestSessionResponseDto,
  GuestProgressResponseDto,
  GuestHistoryResponseDto,
  GuestStoryResponseDto,
} from './dto/guest.dto';

@ApiTags('Guest')
@Controller('guest')
export class GuestController {
  private readonly logger = new Logger(GuestController.name);

  constructor(
    private readonly guestSessionService: GuestSessionService,
    private readonly prisma: PrismaService,
    private readonly storyService: StoryService,
  ) {}

  /**
   * Create a new guest session
   */
  @Post('session')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a new guest session' })
  @ApiResponse({
    status: 201,
    description: 'Guest session created successfully',
    type: CreateGuestSessionResponseDto,
  })
  async createSession(): Promise<CreateGuestSessionResponseDto> {
    const session = await this.guestSessionService.createGuestSession();
    this.logger.log(`Guest session created: ${session.sessionId}`);

    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      expiresIn: GUEST_SESSION_TTL_SECONDS,
    };
  }

  /**
   * Get a story by ID for guest users
   * Requires valid guest session via x-guest-session-id header
   */
  @Get('stories/:storyId')
  @Public()
  @ApiOperation({ summary: 'Get a story by ID for guest users' })
  @ApiParam({ name: 'storyId', description: 'Story ID' })
  @ApiHeader({
    name: 'x-guest-session-id',
    description: 'Guest session ID (required)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Story retrieved successfully',
    type: GuestStoryResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - story not found',
  })
  async getStoryForGuest(
    @Param('storyId') storyId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<GuestStoryResponseDto> {
    this.logger.log(`getStoryForGuest called with sessionId: ${guestSessionId}, storyId: ${storyId}`);

    if (!guestSessionId) {
      throw new BadRequestException('x-guest-session-id header is required');
    }

    // Validate guest session
    const session =
      await this.guestSessionService.getGuestSession(guestSessionId);
    if (!session) {
      this.logger.warn(`Guest session not found: ${guestSessionId}`);
      throw new BadRequestException('Invalid or expired guest session');
    }

    // Check if story was already read (re-reading is always free)
    const alreadyRead = !!session.readingHistory[storyId];

    // If not already read, check quota
    if (!alreadyRead) {
      const quotaStatus =
        await this.guestSessionService.getGuestQuotaStatus(guestSessionId);
      if (quotaStatus && quotaStatus.remaining <= 0) {
        throw new ForbiddenException(
          'You have reached your story limit. Sign up to continue reading!',
        );
      }
    }

    // Get story data
    const story = await this.storyService.getStoryById(storyId);
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // Record story access for quota tracking (only if not already read)
    if (!alreadyRead) {
      await this.guestSessionService.recordNewStoryAccess(guestSessionId, storyId);
    }

    return story;
  }

  /**
   * Get story quota status for guest users
   * Requires valid guest session via x-guest-session-id header
   */
  @Get('quota')
  @Public()
  @ApiOperation({ summary: 'Get story quota status for guest users' })
  @ApiHeader({
    name: 'x-guest-session-id',
    description: 'Guest session ID (required)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Quota status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        isPremium: { type: 'boolean' },
        unlimited: { type: 'boolean' },
        used: { type: 'number' },
        baseLimit: { type: 'number' },
        totalAllowed: { type: 'number' },
        remaining: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  async getGuestQuotaStatus(
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    this.logger.log(`getGuestQuotaStatus called with sessionId: ${guestSessionId}`);

    if (!guestSessionId) {
      throw new BadRequestException('x-guest-session-id header is required');
    }

    const quotaStatus =
      await this.guestSessionService.getGuestQuotaStatus(guestSessionId);

    if (!quotaStatus) {
      this.logger.warn(`Guest quota status not found for sessionId: ${guestSessionId}`);
      throw new BadRequestException('Invalid or expired guest session');
    }

    return quotaStatus;
  }

  /**
   * Update reading progress for a story
   * Works for both guests (via x-guest-session-id header) and authenticated users
   */
  @Post('progress')
  @OptionalAuth()
  @ApiOperation({ summary: 'Update reading progress for a story' })
  @ApiHeader({
    name: 'x-guest-session-id',
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
    @Body() dto: UpdateGuestProgressDto,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(`updateProgress called with sessionId: ${guestSessionId}, storyId: ${dto.storyId}, progress: ${dto.progress}`);

    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
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
      this.logger.log(`Updating guest progress for session: ${guestSessionId}, story: ${dto.storyId}`);
      const updated = await this.guestSessionService.updateGuestProgress(
        guestSessionId,
        dto.storyId,
        clampedProgress,
      );
      if (!updated) {
        this.logger.warn(`Failed to update guest progress for session: ${guestSessionId}`);
        throw new NotFoundException('Guest session not found');
      }
      this.logger.log(`Successfully updated guest progress for session: ${guestSessionId}`);
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
    name: 'x-guest-session-id',
    description: 'Guest session ID (required for unauthenticated users)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Progress retrieved successfully',
    type: GuestProgressResponseDto,
  })
  async getProgress(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<GuestProgressResponseDto | null> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
      );
    }

    if (userId) {
      // Authenticated user - get from database
      const progress = await this.prisma.userStoryProgress.findFirst({
        where: {
          userId,
          storyId,
          isDeleted: false,
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

    // This should never be reached due to the validation above
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
    name: 'x-guest-session-id',
    description: 'Guest session ID (required for unauthenticated users)',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'History retrieved successfully',
    type: GuestHistoryResponseDto,
  })
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<GuestHistoryResponseDto> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
      );
    }

    if (userId) {
      // Authenticated user - get from database
      const progressRecords = await this.prisma.userStoryProgress.findMany({
        where: { userId, isDeleted: false },
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

      const history = session.readingHistory;

      if (!history || Object.keys(history).length === 0) {
        return { stories: [] };
      }

      // Get full story details for each story in history
      const storyIds = Object.keys(history);
      const stories = await this.prisma.story.findMany({
        where: {
          id: { in: storyIds },
          isDeleted: false,
        },
        select: {
          id: true,
          title: true,
          description: true,
          coverImageUrl: true,
          ageMax: true,
          durationSeconds: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Map stories with progress
      const storiesWithProgress = stories.map((story) => {
        const progress = history[story.id];
        return {
          storyId: story.id,
          progress: progress.progress,
          lastAccessed: progress.lastReadAt,
        };
      });

      // Sort by lastAccessed descending
      storiesWithProgress.sort((a, b) => {
        const aTime = new Date(a.lastAccessed).getTime();
        const bTime = new Date(b.lastAccessed).getTime();
        return bTime - aTime;
      });

      return {
        stories: storiesWithProgress,
      };
    }

    // This should never be reached due to the validation above
    return { stories: [] };
  }
}
