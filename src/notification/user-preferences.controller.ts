import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { NotificationService } from './notification.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('users/me')
export class UserPreferencesController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Get notification preferences for the authenticated user',
    description:
      'Returns a grouped map of categories to per-channel status. Example: {"NEW_STORY": {"push": true, "in_app": true}}',
  })
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
  async getUserPreferences(@Req() req: AuthenticatedRequest) {
    return this.notificationService.getUserPreferencesGrouped(
      req.authUserData.userId,
    );
  }

  @Patch('notification-preferences')
  @ApiOperation({
    summary: 'Update notification preferences for the authenticated user',
    description:
      'Updates preferences for one or more categories. Body: {"NEW_STORY": true}. Each category update affects both push and in_app channels.',
  })
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
    @Req() req: AuthenticatedRequest,
    @Body() preferences: Record<string, boolean>,
  ) {
    return this.notificationService.updateUserPreferences(
      req.authUserData.userId,
      preferences,
    );
  }
}
