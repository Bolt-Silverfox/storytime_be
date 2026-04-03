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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalAuth } from '@/shared/decorators/optional-auth.decorator';
import { Public } from '@/shared/decorators/public.decorator';
import {
  OptionalAuthRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import {
  GuestSessionService,
  GUEST_SESSION_TTL_SECONDS,
  GUEST_STORY_LIMIT,
} from './guest-session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ReadStatus } from './dto/guest.dto';
import { StoryService } from '@/story/story.service';
import {
  UpdateGuestProgressDto,
  CreateGuestSessionResponseDto,
  GuestProgressResponseDto,
  GuestHistoryResponseDto,
  GuestStoryResponseDto,
  StoryAccessCheckDto,
} from './dto/guest.dto';

@ApiTags('Guest')
@Controller('guest')
export class GuestController {
  private readonly logger = new Logger(GuestController.name);

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    private readonly guestSessionService: GuestSessionService,
    private readonly prisma: PrismaService,
    private readonly storyService: StoryService,
  ) {}

  private validateSessionId(guestSessionId: string): void {
    if (!GuestController.UUID_REGEX.test(guestSessionId)) {
      throw new BadRequestException('Invalid session ID format');
    }
  }

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
    this.logger.log(
      `Guest session created: ${session.sessionId.slice(0, 8)}...`,
    );

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
    status: 400,
    description: 'Bad Request - missing or invalid x-guest-session-id header',
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
    this.logger.log(
      `getStoryForGuest called with sessionId: ${this.guestSessionService.maskSessionId(guestSessionId)}, storyId: ${storyId}`,
    );

    if (!guestSessionId) {
      throw new BadRequestException('x-guest-session-id header is required');
    }

    this.validateSessionId(guestSessionId);

    // Validate guest session
    const session =
      await this.guestSessionService.getGuestSession(guestSessionId);
    if (!session) {
      this.logger.warn(
        `Guest session not found: ${this.guestSessionService.maskSessionId(guestSessionId)}`,
      );
      throw new UnauthorizedException(
        'Your guest session has expired. Please refresh the page to continue.',
      );
    }

    // Check if story was already read (re-reading is always free)
    const alreadyRead = !!session.readingHistory[storyId];

    // If not already read, check quota
    // Note: The check-then-consume pattern below has a minor race condition
    // (quota could be consumed between check and recordNewStoryAccess).
    // This is acceptable for guest mode — low stakes, non-transactional.
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
      await this.guestSessionService.recordNewStoryAccess(
        guestSessionId,
        storyId,
      );
    }

    return {
      id: story.id,
      title: story.title,
      description: story.description,
      language: story.language,
      categories: story.categories ?? [],
      themes: story.themes ?? [],
      coverImageUrl: story.coverImageUrl,
      audioUrl: story.audioUrl,
      textContent: story.textContent,
      isInteractive: story.isInteractive,
      ageMin: story.ageMin,
      ageMax: story.ageMax,
      images: story.images ?? [],
      branches: story.branches ?? [],
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    };
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
    status: 400,
    description: 'Bad Request - missing or invalid x-guest-session-id header',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  async getGuestQuotaStatus(
    @Headers('x-guest-session-id') guestSessionId?: string,
  ) {
    this.logger.log(
      `getGuestQuotaStatus called with sessionId: ${this.guestSessionService.maskSessionId(guestSessionId)}`,
    );

    if (!guestSessionId) {
      throw new BadRequestException('x-guest-session-id header is required');
    }

    this.validateSessionId(guestSessionId);

    const quotaStatus =
      await this.guestSessionService.getGuestQuotaStatus(guestSessionId);

    if (!quotaStatus) {
      this.logger.warn(
        `Guest quota status not found for sessionId: ${this.guestSessionService.maskSessionId(guestSessionId)}`,
      );
      throw new UnauthorizedException(
        'Your guest session has expired. Please refresh the page to continue.',
      );
    }

    return quotaStatus;
  }

  /**
   * Update reading progress for a story
   * Works for both guests (via x-guest-session-id header) and authenticated users
   */
  @Post('progress')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
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
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  async updateProgress(
    @Req() req: OptionalAuthRequest,
    @Body() dto: UpdateGuestProgressDto,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `updateProgress called with sessionId: ${this.guestSessionService.maskSessionId(guestSessionId)}, storyId: ${dto.storyId}, progress: ${dto.progress}`,
    );

    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
      );
    }

    if (!userId && guestSessionId) {
      this.validateSessionId(guestSessionId);
    }

    const clampedProgress = Math.max(0, Math.min(100, dto.progress));

    if (userId) {
      // Authenticated user - update in database
      await this.prisma.userStoryProgress.upsert({
        where: {
          userId_storyId: { userId, storyId: dto.storyId },
        },
        update: {
          progress: clampedProgress,
          completed: clampedProgress >= 100,
          lastAccessed: new Date(),
          isDeleted: false,
        },
        create: {
          userId,
          storyId: dto.storyId,
          progress: clampedProgress,
          completed: clampedProgress >= 100,
          lastAccessed: new Date(),
        },
      });
    } else if (guestSessionId) {
      // Guest user - update in Redis
      this.logger.log(
        `Updating guest progress for session: ${this.guestSessionService.maskSessionId(guestSessionId)}, story: ${dto.storyId}`,
      );
      const updated = await this.guestSessionService.updateGuestProgress(
        guestSessionId,
        dto.storyId,
        clampedProgress,
      );
      if (!updated) {
        this.logger.warn(
          `Failed to update guest progress for session: ${this.guestSessionService.maskSessionId(guestSessionId)}`,
        );
        throw new UnauthorizedException(
          'Your guest session has expired. Please refresh the page to continue.',
        );
      }
      this.logger.log(
        `Successfully updated guest progress for session: ${this.guestSessionService.maskSessionId(guestSessionId)}`,
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
  @UseGuards(AuthSessionGuard)
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
  @ApiResponse({
    status: 400,
    description:
      'Bad Request - missing guest session ID for unauthenticated users',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  async getProgress(
    @Req() req: OptionalAuthRequest,
    @Param('storyId') storyId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<GuestProgressResponseDto | null> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
      );
    }

    if (!userId && guestSessionId) {
      this.validateSessionId(guestSessionId);
    }

    let progressData: { progress: number; lastAccessed: Date } | null = null;

    if (userId) {
      // Authenticated user - get from database
      const record = await this.prisma.userStoryProgress.findFirst({
        where: {
          userId,
          storyId,
          isDeleted: false,
        },
        select: {
          progress: true,
          lastAccessed: true,
        },
      });

      if (!record) {
        return null;
      }

      progressData = {
        progress: record.progress,
        lastAccessed: record.lastAccessed,
      };
    } else if (guestSessionId) {
      // Guest user - get from Redis
      const session =
        await this.guestSessionService.getGuestSession(guestSessionId);

      if (!session) {
        throw new UnauthorizedException(
          'Your guest session has expired. Please refresh the page to continue.',
        );
      }

      const storyProgress = session.readingHistory[storyId];

      if (!storyProgress) {
        return null;
      }

      progressData = {
        progress: storyProgress.progress,
        lastAccessed: storyProgress.lastReadAt,
      };
    }

    if (!progressData) {
      return null;
    }

    // Fetch story details to enrich the response
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, isDeleted: false },
      select: {
        id: true,
        title: true,
        description: true,
        coverImageUrl: true,
        ageMax: true,
        ageMin: true,
        durationSeconds: true,
        createdAt: true,
        updatedAt: true,
        categories: {
          select: {
            id: true,
            name: true,
            image: true,
            description: true,
          },
        },
      },
    });

    if (!story) {
      return null;
    }

    const isDone = progressData.progress >= 100;
    const readStatus: ReadStatus = isDone ? 'done' : 'reading';

    return {
      storyId,
      title: story.title,
      description: story.description,
      coverImageUrl: story.coverImageUrl,
      ageMax: story.ageMax,
      ageMin: story.ageMin,
      durationSeconds: story.durationSeconds,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
      categories: story.categories,
      progress: progressData.progress,
      lastAccessed: progressData.lastAccessed,
      totalTimeSpent: 0,
      readStatus,
    };
  }

  /**
   * Get reading history
   * Works for both guests and authenticated users
   */
  @Get('history')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
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
  @ApiResponse({
    status: 400,
    description:
      'Bad Request - missing guest session ID for unauthenticated users',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired guest session',
  })
  async getHistory(
    @Req() req: OptionalAuthRequest,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<GuestHistoryResponseDto> {
    const userId = req.authUserData?.userId;

    if (!userId && !guestSessionId) {
      throw new BadRequestException(
        'Either authentication or x-guest-session-id header is required',
      );
    }

    if (!userId && guestSessionId) {
      this.validateSessionId(guestSessionId);
    }

    if (userId) {
      // Authenticated user - get from database
      const progressRecords = await this.prisma.userStoryProgress.findMany({
        where: { userId, isDeleted: false },
        select: {
          storyId: true,
          progress: true,
          lastAccessed: true,
          story: {
            select: {
              id: true,
              title: true,
              description: true,
              coverImageUrl: true,
              ageMax: true,
              ageMin: true,
              durationSeconds: true,
              createdAt: true,
              updatedAt: true,
              categories: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                  description: true,
                },
              },
            },
          },
        },
        orderBy: { lastAccessed: 'desc' },
      });

      return {
        stories: progressRecords.map((record) => {
          const isDone = record.progress >= 100;
          const readStatus: ReadStatus = isDone ? 'done' : 'reading';
          return {
            storyId: record.storyId,
            title: record.story.title,
            description: record.story.description,
            coverImageUrl: record.story.coverImageUrl,
            ageMax: record.story.ageMax,
            ageMin: record.story.ageMin,
            durationSeconds: record.story.durationSeconds,
            createdAt: record.story.createdAt,
            updatedAt: record.story.updatedAt,
            categories: record.story.categories,
            progress: record.progress,
            lastAccessed: record.lastAccessed,
            totalTimeSpent: 0,
            readStatus,
          };
        }),
      };
    } else if (guestSessionId) {
      // Guest user - get from Redis
      const session =
        await this.guestSessionService.getGuestSession(guestSessionId);

      if (!session) {
        throw new UnauthorizedException(
          'Your guest session has expired. Please refresh the page to continue.',
        );
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
          ageMin: true,
          durationSeconds: true,
          createdAt: true,
          updatedAt: true,
          categories: {
            select: {
              id: true,
              name: true,
              image: true,
              description: true,
            },
          },
        },
      });

      // Map stories with progress and readStatus
      const storiesWithProgress = stories.map((story) => {
        const progress = history[story.id];
        const isDone = progress.progress >= 100;
        const readStatus: ReadStatus = isDone ? 'done' : 'reading';
        return {
          storyId: story.id,
          title: story.title,
          description: story.description,
          coverImageUrl: story.coverImageUrl,
          ageMax: story.ageMax,
          ageMin: story.ageMin,
          durationSeconds: story.durationSeconds,
          createdAt: story.createdAt,
          updatedAt: story.updatedAt,
          categories: story.categories,
          progress: progress.progress,
          lastAccessed: progress.lastReadAt,
          totalTimeSpent: 0, // Not tracked for guests
          readStatus,
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

  /**
   * Check if a guest can access a specific story
   * Returns access status and quota information without consuming quota
   */
  @Get('stories/:storyId/access')
  @Public()
  @ApiOperation({ summary: 'Check if guest can access a specific story' })
  @ApiParam({ name: 'storyId', description: 'Story ID' })
  @ApiHeader({
    name: 'x-guest-session-id',
    description: 'Guest session ID (required)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Access check completed',
    type: StoryAccessCheckDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - invalid x-guest-session-id header format',
  })
  async checkStoryAccess(
    @Param('storyId') storyId: string,
    @Headers('x-guest-session-id') guestSessionId?: string,
  ): Promise<StoryAccessCheckDto> {
    if (!guestSessionId) {
      return {
        canAccess: false,
        reason: 'Missing guest session',
        storiesRead: 0,
        remaining: 0,
        totalAllowed: GUEST_STORY_LIMIT,
        alreadyRead: false,
      };
    }

    this.validateSessionId(guestSessionId);

    const session =
      await this.guestSessionService.getGuestSession(guestSessionId);
    if (!session) {
      return {
        canAccess: false,
        reason: 'Invalid or expired guest session',
        storiesRead: 0,
        remaining: 0,
        totalAllowed: GUEST_STORY_LIMIT,
        alreadyRead: false,
      };
    }
    // Check that story exists and is not deleted
    const story = await this.storyService.getStoryById(storyId);
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // Check if story was already read
    const alreadyRead = !!session.readingHistory[storyId];
    const storiesRead = session.uniqueStoriesRead;
    const remaining = Math.max(0, GUEST_STORY_LIMIT - storiesRead);

    // Can access if already read or under quota
    const canAccess = alreadyRead || storiesRead < GUEST_STORY_LIMIT;

    return {
      canAccess,
      storiesRead,
      remaining,
      totalAllowed: GUEST_STORY_LIMIT,
      alreadyRead,
      reason: !canAccess ? 'Guest quota exceeded' : undefined,
    };
  }
}
