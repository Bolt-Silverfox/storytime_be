import { Controller, Get, Logger, Param, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminUserHistoryService } from './admin-user-history.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import {
  UserActivityQueryDto,
  UserReadingQueryDto,
} from './dto/admin-user-history.dto';
import type { AuthenticatedRequest } from '@/shared/guards/auth.guard';

// Same dot-namespaced convention / targetType as the other `user.*` actions.
export const USER_VIEW_ACTIVITY_ACTION = 'user.view_activity';
export const USER_VIEW_READING_ACTION = 'user.view_reading';

function definedOnly(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminUserHistoryController {
  private readonly logger = new Logger(AdminUserHistoryController.name);

  constructor(
    private readonly historyService: AdminUserHistoryService,
    private readonly auditLog: AdminAuditLogService,
  ) {}

  /**
   * Viewing a user's (and their children's) history is itself audited.
   * Fire-and-forget: an audit failure is logged and must never break the
   * response. Only the request parameters are recorded, never the data
   * returned.
   */
  private audit(
    req: AuthenticatedRequest,
    action: string,
    userId: string,
    page: number,
    filters: Record<string, unknown>,
  ): void {
    try {
      void Promise.resolve(
        this.auditLog.record({
          adminId: req.authUserData.userId,
          adminEmail: req.authUserData.email,
          action,
          targetType: 'User',
          targetId: userId,
          details: { page, filters: definedOnly(filters) },
        }),
      ).catch((err: unknown) => this.logAuditFailure(action, err));
    } catch (err) {
      this.logAuditFailure(action, err);
    }
  }

  private logAuditFailure(action: string, err: unknown): void {
    this.logger.error(
      `Failed to record audit log "${action}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  @Get('users/:userId/activity')
  @ApiOperation({
    summary: "Get a user's activity timeline (including their children)",
    description:
      "Paginated, newest-first activity log for the user and the user's non-deleted kids. `details` is sanitised (secret-like fields and email addresses are redacted). Recorded in the admin audit log as `user.view_activity`.",
  })
  @ApiParam({ name: 'userId', type: String, description: 'User ID' })
  @ApiOkResponse({
    description: 'User activity retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User activity retrieved successfully',
        data: [
          {
            id: 'log-1',
            action: 'STORY_READ',
            createdAt: '2026-01-10T12:00:00.000Z',
            kidId: 'kid-1',
            kidName: 'Emma',
            storyId: 'story-1',
            storyTitle: 'The Brave Fox',
            details: { storyId: 'story-1' },
          },
        ],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found (or soft-deleted)' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async getUserActivity(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query() query: UserActivityQueryDto,
  ) {
    const result = await this.historyService.getActivity(userId, query);
    this.audit(req, USER_VIEW_ACTIVITY_ACTION, userId, query.page ?? 1, {
      action: query.action,
      from: query.from,
      to: query.to,
      kidId: query.kidId,
    });
    return {
      statusCode: 200,
      message: 'User activity retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/:userId/reading')
  @ApiOperation({
    summary: "Get a user's reading history (including their children)",
    description:
      "Paginated, newest-first reading history: the user's own progress (`readerType: user`) plus each non-deleted kid's (`readerType: kid`). `progress` is a percentage 0-100 as stored. `summary` reflects the same filters. Per-user view, so the 5-reader suppression of aggregate story stats does not apply. Recorded in the admin audit log as `user.view_reading`.",
  })
  @ApiParam({ name: 'userId', type: String, description: 'User ID' })
  @ApiOkResponse({
    description: 'User reading history retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User reading history retrieved successfully',
        data: [
          {
            storyId: 'story-1',
            title: 'The Brave Fox',
            readerType: 'kid',
            kidId: 'kid-1',
            kidName: 'Emma',
            progress: 100,
            completed: true,
            totalTimeSpentSeconds: 540,
            lastAccessed: '2026-01-10T12:00:00.000Z',
          },
        ],
        summary: {
          storiesRead: 1,
          storiesCompleted: 1,
          totalTimeSpentSeconds: 540,
          lastActiveAt: '2026-01-10T12:00:00.000Z',
          kids: [{ kidId: 'kid-1', name: 'Emma', storiesRead: 1 }],
        },
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'User not found (or soft-deleted)' })
  @ApiForbiddenResponse({ description: 'Admin access required' })
  async getUserReading(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query() query: UserReadingQueryDto,
  ) {
    const result = await this.historyService.getReading(userId, query);
    this.audit(req, USER_VIEW_READING_ACTION, userId, query.page ?? 1, {
      range: query.range,
      startDate: query.startDate,
      endDate: query.endDate,
      kidId: query.kidId,
    });
    return {
      statusCode: 200,
      message: 'User reading history retrieved successfully',
      data: result.data,
      summary: result.summary,
      meta: result.meta,
    };
  }
}
