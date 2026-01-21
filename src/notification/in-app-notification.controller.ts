import {
    Controller,
    Get,
    Patch,
    Body,
    Query,
    Param,
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
import { NotificationService } from './notification.service';
import { NotificationDto, MarkReadDto } from './notification.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('notifications')
export class InAppNotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get()
    @ApiOperation({ summary: 'Get in-app notifications for current user' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'offset', required: false, type: Number })
    @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
    @ApiResponse({ status: 200, type: [NotificationDto] })
    async getNotifications(
        @Request() req: AuthenticatedRequest,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number,
        @Query('unreadOnly') unreadOnly?: boolean,
    ) {
        return this.notificationService.getInAppNotifications(
            req.authUserData.userId,
            limit ? Number(limit) : undefined,
            offset ? Number(offset) : undefined,
            unreadOnly === true || String(unreadOnly) === 'true',
        );
    }

    @Patch('mark-read')
    @ApiOperation({ summary: 'Mark specific notifications as read' })
    @ApiResponse({ status: 200 })
    async markAsRead(
        @Request() req: AuthenticatedRequest,
        @Body() dto: MarkReadDto,
    ) {
        await this.notificationService.markAsRead(req.authUserData.userId, dto.notificationIds);
        return { success: true };
    }

    @Patch('mark-all-read')
    @ApiOperation({ summary: 'Mark all notifications as read' })
    @ApiResponse({ status: 200 })
    async markAllAsRead(@Request() req: AuthenticatedRequest) {
        await this.notificationService.markAllAsRead(req.authUserData.userId);
        return { success: true };
    }
}
