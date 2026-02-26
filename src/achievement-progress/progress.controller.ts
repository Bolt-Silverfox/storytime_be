import {
  Controller,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProgressService } from './progress.service';
import { StreakService } from './streak.service';
import { BadgeService } from './badge.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { ProgressHomeResponseDto } from './dto/progress-response.dto';
import { ProgressOverviewResponseDto } from './dto/progress-response.dto';
import { StreakResponseDto } from './dto/streak-response.dto';
import { FullBadgeListResponseDto } from './dto/badge-response.dto';
import { BadgePreviewDto } from './dto/badge-response.dto';

@ApiTags('Progress & Achievements')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller()
export class ProgressController {
  constructor(
    private progressService: ProgressService,
    private streakService: StreakService,
    private badgeService: BadgeService,
  ) {}

  @Get('/progress/home')
  @ApiOperation({
    summary: 'Get Progress & Achievements home screen data',
    description:
      'Aggregates streak, badge preview, and progress stats in one call',
  })
  @ApiResponse({
    status: 200,
    type: ProgressHomeResponseDto,
    description: 'Successfully retrieved home screen data',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async getHomeScreenData(
    @Req() req: AuthenticatedRequest,
  ): Promise<ProgressHomeResponseDto> {
    return this.progressService.getHomeScreenData(req.authUserData.userId);
  }

  @Get('/api/v1/progress/streak')
  @ApiOperation({
    summary: 'Get user streak summary',
    description: 'Returns current streak and weekly activity',
  })
  @ApiResponse({
    status: 200,
    type: StreakResponseDto,
    description: 'Successfully retrieved streak data',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async getStreakSummary(
    @Req() req: AuthenticatedRequest,
  ): Promise<StreakResponseDto> {
    return this.streakService.getStreakSummary(req.authUserData.userId);
  }

  @Get('/progress/badges/preview')
  @ApiOperation({
    summary: 'Get badge preview (top 3)',
    description: 'Returns up to 3 badges sorted by priority and unlock status',
  })
  @ApiResponse({
    status: 200,
    type: [BadgePreviewDto],
    description: 'Successfully retrieved badge preview',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async getBadgePreview(
    @Req() req: AuthenticatedRequest,
  ): Promise<BadgePreviewDto[]> {
    return this.badgeService.getBadgePreview(req.authUserData.userId);
  }

  @Get('/progress/badges')
  @ApiOperation({
    summary: 'Get full badge list',
    description: 'Returns all badges with unlock status and progress',
  })
  @ApiResponse({
    status: 200,
    type: FullBadgeListResponseDto,
    description: 'Successfully retrieved full badge list',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async getFullBadgeList(
    @Req() req: AuthenticatedRequest,
  ): Promise<FullBadgeListResponseDto> {
    return this.badgeService.getFullBadgeList(req.authUserData.userId);
  }

  @Get('/api/v1/progress/overview')
  @ApiOperation({
    summary: 'Get progress overview (lightweight)',
    description: 'Lightweight summary of streak, badges, and key metrics',
  })
  @ApiResponse({
    status: 200,
    type: ProgressOverviewResponseDto,
    description: 'Successfully retrieved progress overview',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async getProgressOverview(
    @Req() req: AuthenticatedRequest,
  ): Promise<ProgressOverviewResponseDto> {
    return this.progressService.getOverview(req.authUserData.userId);
  }
}
