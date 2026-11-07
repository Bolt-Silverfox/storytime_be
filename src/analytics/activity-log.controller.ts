import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CreateActivityLogDto, ActivityLogDto } from './dto/analytics.dto';
import { UAParser } from 'ua-parser-js';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { AccessControlService } from '@/shared/access/access-control.service';

@ApiTags('activity-logs')
@Controller('activity-logs')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
export class ActivityLogController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Log an activity' })
  @ApiBody({ type: CreateActivityLogDto })
  @ApiResponse({ status: 201, type: ActivityLogDto })
  async create(
    @Body() dto: CreateActivityLogDto,
    @Req() req: AuthenticatedRequest,
  ) {
    dto.userId = this.accessControl.resolveUserId(req.authUserData, dto.userId);
    if (dto.kidId) {
      await this.accessControl.assertKidAccess(req.authUserData, dto.kidId);
    }
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
  async getForUser(
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.accessControl.assertSelfOrAdmin(req.authUserData, userId);
    return this.analyticsService.getForUser(userId);
  }

  @Get('kid/:kidId')
  @ApiOperation({ summary: 'Get activity logs for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [ActivityLogDto] })
  async getForKid(
    @Param('kidId') kidId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.accessControl.assertKidAccess(req.authUserData, kidId);
    return this.analyticsService.getForKid(kidId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an activity log by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: ActivityLogDto })
  async getById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const log = await this.analyticsService.getById(id);
    if (log) await this.accessControl.assertOwner(req.authUserData, log);
    return log;
  }
}
