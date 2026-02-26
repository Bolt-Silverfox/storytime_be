import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { InAppNotificationService } from './services/in-app-notification.service';
import { NotificationDto, MarkReadDto } from './dto/notification.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { PaginationUtil } from '@/shared/utils/pagination.util';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('notifications')
export class InAppNotificationController {
  constructor(
    private readonly inAppNotificationService: InAppNotificationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get in-app notifications for current user' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Opaque cursor for cursor-based pagination',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: [NotificationDto] })
  async getNotifications(
    @Request() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('unreadOnly') unreadOnly?: boolean,
  ) {
    const isUnreadOnly = unreadOnly === true || String(unreadOnly) === 'true';

    // Cursor mode: if cursor param is present, use cursor-based pagination
    if (cursor !== undefined) {
      const { cursorId, limit: safeLimit } =
        PaginationUtil.sanitizeCursorParams(cursor, limit);
      return this.inAppNotificationService.getInAppNotificationsCursor(
        req.authUserData.userId,
        cursorId,
        safeLimit,
        isUnreadOnly,
      );
    }

    // Offset mode (default): existing pagination
    return this.inAppNotificationService.getInAppNotifications(
      req.authUserData.userId,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
      isUnreadOnly,
    );
  }

  @Patch('mark-read')
  @ApiOperation({ summary: 'Mark specific notifications as read' })
  @ApiResponse({ status: 200 })
  async markAsRead(
    @Request() req: AuthenticatedRequest,
    @Body() dto: MarkReadDto,
  ) {
    await this.inAppNotificationService.markAsRead(
      req.authUserData.userId,
      dto.notificationIds,
    );
    return { success: true };
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200 })
  async markAllAsRead(@Request() req: AuthenticatedRequest) {
    await this.inAppNotificationService.markAllAsRead(req.authUserData.userId);
    return { success: true };
  }
}
