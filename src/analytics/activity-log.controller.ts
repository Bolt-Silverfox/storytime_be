import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CreateActivityLogDto, ActivityLogDto } from './analytics.dto';

@ApiTags('activity-logs')
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post()
  @ApiOperation({ summary: 'Log an activity' })
  @ApiBody({ type: CreateActivityLogDto })
  @ApiResponse({ status: 201, type: ActivityLogDto })
  async create(@Body() dto: CreateActivityLogDto) {
    return this.analyticsService.create(dto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get activity logs for a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, type: [ActivityLogDto] })
  async getForUser(@Param('userId') userId: string) {
    return this.analyticsService.getForUser(userId);
  }

  @Get('kid/:kidId')
  @ApiOperation({ summary: 'Get activity logs for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [ActivityLogDto] })
  async getForKid(@Param('kidId') kidId: string) {
    return this.analyticsService.getForKid(kidId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an activity log by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: ActivityLogDto })
  async getById(@Param('id') id: string) {
    return this.analyticsService.getById(id);
  }
}
