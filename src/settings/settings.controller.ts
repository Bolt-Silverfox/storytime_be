import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  explicitContent?: boolean;
  maxScreenTimeMins?: number;
  language?: string;
  country?: string;
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get(':userId')
  @ApiOperation({
    summary: 'Get user settings',
    description: 'Retrieve settings for a user by user ID.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'The user ID',
  })
  @ApiResponse({
    status: 200,
    description: 'User settings returned.',
    schema: {
      example: {
        userId: 'abc123',
        explicitContent: true,
        maxScreenTimeMins: 60,
        language: 'en',
        country: 'nigeria',
        createdAt: '2023-10-01T12:00:00Z',
        updatedAt: '2023-10-01T12:00:00Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Settings not found.' })
  async getSettings(@Param('userId') userId: string) {
    // Example only: Replace with real logic
    return this.settingsService.getSettings(userId);
  }

  @Put(':userId')
  @ApiOperation({
    summary: 'Update user settings',
    description: 'Update settings for a user by user ID.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'The user ID',
  })
  @ApiBody({
    type: UpdateSettingsDto,
    examples: {
      example1: {
        value: {
          explicitContent: false,
          maxScreenTimeMins: 120,
          language: 'fr',
          country: 'france',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User settings updated.',
    schema: {
      example: {
        userId: 'abc123',
        explicitContent: false,
        maxScreenTimeMins: 120,
        language: 'fr',
        country: 'france',
        createdAt: '2023-10-01T12:00:00Z',
        updatedAt: '2023-10-01T12:00:00Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Settings not found.' })
  async updateSettings(
    @Param('userId') userId: string,
    @Body() body: UpdateSettingsDto,
  ) {
    // Example only: Replace with real logic
    return this.settingsService.updateSettings(userId, body);
  }
}
