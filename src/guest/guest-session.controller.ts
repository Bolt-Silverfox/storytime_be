import {
  Controller,
  Get,
  Post,
  Headers,
  BadRequestException,
  Logger,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
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
} from './guest-session.service';
import { ReadStatus } from './dto/guest.dto';
import { deriveReadStatus } from '@/shared/utils/read-status.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GuestActivityEvent } from './events/guest-activity.event';
import { GUEST_SESSION_CREATED } from './guest-activity.constants';
import {
  CreateGuestSessionResponseDto,
  GuestHistoryResponseDto,
} from './dto/guest.dto';

@ApiTags('Guest')
@Controller('guest')
export class GuestSessionController {
  private readonly logger = new Logger(GuestSessionController.name);

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    private readonly guestSessionService: GuestSessionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private validateSessionId(guestSessionId: string): void {
    if (!GuestSessionController.UUID_REGEX.test(guestSessionId)) {
      throw new BadRequestException('Invalid session ID format');
    }
  }

  private emitGuestActivity(
    action: string,
    details: Record<string, unknown>,
  ): void {
    const handled = this.eventEmitter.emit(
      'guest.activity',
      new GuestActivityEvent(action, JSON.stringify(details)),
    );
    if (!handled) {
      this.logger.warn(
        `No listener handled guest.activity for action=${action}`,
      );
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

    this.emitGuestActivity(GUEST_SESSION_CREATED, {
      guestSessionId: this.guestSessionService.maskSessionId(session.sessionId),
    });

    return {
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      expiresIn: GUEST_SESSION_TTL_SECONDS,
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
      const progressRecords =
        await this.guestSessionService.getUserReadingHistory(userId);

      return {
        stories: progressRecords.map((record) => {
          const readStatus: ReadStatus | null = deriveReadStatus(
            record.progress,
            record.completed,
          );
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
      const stories =
        await this.guestSessionService.getStoryDetailsByIds(storyIds);

      // Map stories with progress and readStatus
      const storiesWithProgress = stories.map((story) => {
        const progress = history[story.id];
        const readStatus: ReadStatus | null = deriveReadStatus(
          progress.progress,
          progress.completed,
        );
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
}
