import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiParam,
    ApiBody,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import {
    UpdateUserPreferencesDto,
    UserPreferencesResponseDto,
} from './notification.dto';

@ApiTags('users')
@Controller('users')
export class UserPreferencesController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get(':userId/notification-preferences')
    @ApiOperation({
        summary: 'Get notification preferences for a user',
        description:
            'Returns a grouped map of categories to per-channel status.',
    })
    @ApiParam({ name: 'userId', type: String })
    @ApiResponse({
        status: 200,
        description: 'User notification preferences in grouped format',
        type: UserPreferencesResponseDto,
    })
    async getUserPreferences(@Param('userId') userId: string) {
        return this.notificationService.getUserPreferencesGrouped(userId);
    }

    @Patch(':userId/notification-preferences')
    @ApiOperation({
        summary: 'Update notification preferences for a user',
        description:
            'Updates preferences for one or more categories. Each category update affects both push and in_app channels.',
    })
    @ApiParam({ name: 'userId', type: String })
    @ApiBody({ type: UpdateUserPreferencesDto })
    @ApiResponse({
        status: 200,
        description: 'Updated notification preferences in grouped format',
        type: UserPreferencesResponseDto,
    })
    async updateUserPreferences(
        @Param('userId') userId: string,
        @Body() preferences: UpdateUserPreferencesDto,
    ) {
        return this.notificationService.updateUserPreferences(userId, preferences as unknown as Record<string, boolean>);
    }
}
