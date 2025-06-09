import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get(':userId')
  @ApiOperation({ summary: 'Get user settings', description: 'Retrieve settings for a user by user ID.' })
  @ApiParam({ name: 'userId', type: Number })
  @ApiResponse({ status: 200, description: 'User settings returned.' })
  @ApiResponse({ status: 404, description: 'Settings not found.' })
  async getSettings(@Param('userId') userId: number) {
    // Example only: Replace with real logic
    return this.settingsService.getSettings(userId);
  }

  @Put(':userId')
  @ApiOperation({ summary: 'Update user settings', description: 'Update settings for a user by user ID.' })
  @ApiParam({ name: 'userId', type: Number })
  @ApiResponse({ status: 200, description: 'User settings updated.' })
  @ApiResponse({ status: 404, description: 'Settings not found.' })
  async updateSettings(@Param('userId') userId: number, @Body() body: any) {
    // Example only: Replace with real logic
    return this.settingsService.updateSettings(userId, body);
  }
}
