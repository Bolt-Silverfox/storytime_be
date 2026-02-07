import { Controller, Get, Put, Patch, Post, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { UpdateSettingsDto, SetKidDailyLimitDto } from './dto/settings.dto';

@ApiTags('settings')
@Controller('settings')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) { }

  // ============== PARENT SETTINGS (Existing) ==============

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
    return this.settingsService.getSettings(userId);
  }

  @Put(':userId')
  @ApiOperation({
    summary: 'Update user settings',
    description:
      'Update settings for a user by user ID. maxScreenTimeMins is the default limit for all kids.',
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
    return this.settingsService.updateSettings(userId, body);
  }

  // ============== KID-SPECIFIC SETTINGS (New) ==============

  @Patch('kid/:kidId/daily-limit')
  @ApiOperation({
    summary: 'Set daily screen time limit for a specific kid',
    description:
      'Override parent default with kid-specific limit. Set null to use parent default.',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiBody({ type: SetKidDailyLimitDto })
  @ApiResponse({
    status: 200,
    description: 'Kid daily limit updated',
    schema: {
      example: {
        success: true,
        kidId: 'kid-uuid',
        limitMins: 120,
      },
    },
  })
  async setKidDailyLimit(
    @Param('kidId') kidId: string,
    @Body() body: SetKidDailyLimitDto,
  ) {
    return this.settingsService.setKidDailyLimit(kidId, body.limitMins);
  }

  @Get('kid/:kidId/daily-limit')
  @ApiOperation({
    summary: 'Get daily limit for a specific kid',
    description: 'Returns kid-specific limit, or parent default, or none',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Kid daily limit retrieved',
    schema: {
      example: {
        kidId: 'kid-uuid',
        limitMins: 120,
        source: 'kid', // or 'parent' or 'none'
      },
    },
  })
  async getKidDailyLimit(@Param('kidId') kidId: string) {
    return this.settingsService.getKidDailyLimit(kidId);
  }

  @Get('parent/:parentId/kids-limits')
  @ApiOperation({
    summary: 'Get all kids screen time settings for a parent',
    description: 'Shows which kids have custom limits vs using parent default',
  })
  @ApiParam({ name: 'parentId', type: String })
  @ApiResponse({
    status: 200,
    description: 'All kids screen time settings',
    schema: {
      example: [
        {
          kidId: 'kid1',
          kidName: 'Jacob',
          avatarUrl: 'https://...',
          customLimit: 120,
          effectiveLimit: 120,
          isCustom: true,
        },
        {
          kidId: 'kid2',
          kidName: 'Jane',
          avatarUrl: 'https://...',
          customLimit: null,
          effectiveLimit: 60, // from parent default
          isCustom: false,
        },
      ],
    },
  })
  async getKidsScreenTimeSettings(@Param('parentId') parentId: string) {
    return this.settingsService.getKidsScreenTimeSettings(parentId);
  }

  @Post('parent/:parentId/apply-default-to-kids')
  @ApiOperation({
    summary: 'Apply parent default screen time to all kids',
    description:
      "Updates all kids that don't have custom limits with parent default",
  })
  @ApiParam({ name: 'parentId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Default applied to kids',
    schema: {
      example: {
        success: true,
        appliedLimit: 60,
        kidsUpdated: 2,
      },
    },
  })
  async applyDefaultToAllKids(@Param('parentId') parentId: string) {
    return this.settingsService.applyDefaultToAllKids(parentId);
  }
}
