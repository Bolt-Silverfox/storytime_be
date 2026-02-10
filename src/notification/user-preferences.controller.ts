import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationPreferenceService } from './services/notification-preference.service';

@ApiTags('users')
@Controller('users')
export class UserPreferencesController {
  constructor(
    private readonly notificationPreferenceService: NotificationPreferenceService,
  ) {}

  @Get(':userId/notification-preferences')
  @ApiOperation({
    summary: 'Get notification preferences for a user',
    description:
      'Returns a grouped map of categories to per-channel status. Example: {"NEW_STORY": {"push": true, "in_app": true}}',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({
    status: 200,
    description: 'User notification preferences in grouped format',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          push: { type: 'boolean' },
          in_app: { type: 'boolean' },
        },
      },
      example: {
        NEW_STORY: { push: true, in_app: true },
        STORY_FINISHED: { push: false, in_app: false },
      },
    },
  })
  async getUserPreferences(@Param('userId') userId: string) {
    return this.notificationPreferenceService.getUserPreferencesGrouped(userId);
  }

  @Patch(':userId/notification-preferences')
  @ApiOperation({
    summary: 'Update notification preferences for a user',
    description:
      'Updates preferences for one or more categories. Body: {"NEW_STORY": true}. Each category update affects both push and in_app channels.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
      example: { NEW_STORY: true, STORY_FINISHED: false },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Updated notification preferences in grouped format',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          push: { type: 'boolean' },
          in_app: { type: 'boolean' },
        },
      },
      example: {
        NEW_STORY: { push: true, in_app: true },
        STORY_FINISHED: { push: false, in_app: false },
      },
    },
  })
  async updateUserPreferences(
    @Param('userId') userId: string,
    @Body() preferences: Record<string, boolean>,
  ) {
    return this.notificationPreferenceService.updateUserPreferences(
      userId,
      preferences,
    );
  }
}
