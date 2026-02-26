import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CreateActivityLogDto, ActivityLogDto } from './dto/analytics.dto';
import { UAParser } from 'ua-parser-js';
import { Request } from 'express';

@ApiTags('activity-logs')
@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post()
  @ApiOperation({ summary: 'Log an activity' })
  @ApiBody({ type: CreateActivityLogDto })
  @ApiResponse({ status: 201, type: ActivityLogDto })
  async create(@Body() dto: CreateActivityLogDto, @Req() req: Request) {
    // Detect IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    // Detect device info from User-Agent
    const parser = new UAParser(req.headers['user-agent'] as string);
    const ua = parser.getResult();
    dto.os = ua.os.name + ' ' + ua.os.version;
    dto.deviceName = ua.device.model || ua.browser.name;
    dto.deviceModel = ua.device.vendor || 'unknown';
    dto.ipAddress = ip as string;
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
