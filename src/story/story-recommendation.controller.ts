import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

import {
  ErrorResponseDto,
  ParentRecommendationDto,
  RecommendationResponseDto,
  RecommendationsStatsDto,
  StoryDto,
  TopPickStoryDto,
} from './dto/story.dto';
import { StoryService } from './story.service';

import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryRecommendationController {
  constructor(
    private readonly storyService: StoryService,
    private readonly prisma: PrismaService,
  ) {}

  private async verifyKidOwnership(kidId: string, userId: string) {
    const kid = await this.prisma.kid.findFirst({
      where: { id: kidId, parentId: userId, isDeleted: false },
    });
    if (!kid) {
      throw new NotFoundException(
        `Kid ${kidId} not found or does not belong to this user`,
      );
    }
    return kid;
  }

  // --- PARENT RECOMMENDATIONS ---

  @Post('recommend')
  @ApiOperation({ summary: 'Recommend a story to your kid' })
  @ApiBody({ type: ParentRecommendationDto })
  @ApiOkResponse({
    description: 'Story recommended successfully',
    type: RecommendationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async recommendStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: ParentRecommendationDto,
  ) {
    await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
    return this.storyService.recommendStoryToKid(req.authUserData.userId, body);
  }

  @Get('recommendations/kid/:kidId')
  @ApiOperation({ summary: 'Get all recommended stories for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiOkResponse({
    description: 'List of recommended stories',
    type: RecommendationResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getKidRecommendations(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    return this.storyService.getKidRecommendations(
      kidId,
      req.authUserData.userId,
    );
  }

  @Delete('recommendations/:recommendationId')
  @ApiOperation({ summary: 'Delete a recommendation' })
  @ApiParam({ name: 'recommendationId', type: String })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete (default: false - soft delete)',
  })
  @ApiOkResponse({ description: 'Recommendation deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async deleteRecommendation(
    @Req() req: AuthenticatedRequest,
    @Param('recommendationId') recommendationId: string,
    @Query('permanent') permanent: boolean = false,
  ) {
    return this.storyService.deleteRecommendation(
      recommendationId,
      req.authUserData.userId,
      permanent,
    );
  }

  @Get('recommendations/kid/:kidId/stats')
  @ApiOperation({ summary: 'Get recommendation statistics for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiOkResponse({
    description: 'Recommendation statistics',
    type: RecommendationsStatsDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getRecommendationStats(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    return this.storyService.getRecommendationStats(
      kidId,
      req.authUserData.userId,
    );
  }

  @Get('recommendations/top-picks')
  @UseInterceptors(CacheInterceptor)
  @CacheKey('recommendations:top-picks')
  @CacheTTL(30 * 60 * 1000) // 30 minutes
  @ApiOperation({
    summary: 'Get top picked stories by parents (most recommended)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of stories to return (default: 10)',
  })
  @ApiOkResponse({
    description: 'List of top picked stories with recommendation counts',
    type: TopPickStoryDto,
    isArray: true,
  })
  async getTopPicksFromParents(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.storyService.getTopPicksFromParents(Math.min(limit, 50));
  }

  @Get('top-picks-from-us')
  @UseInterceptors(CacheInterceptor)
  @CacheKey(CACHE_KEYS.TOP_PICKS_FROM_US)
  @CacheTTL(CACHE_TTL_MS.TOP_PICKS_FROM_US)
  @ApiOperation({
    summary: 'Get curated random stories (refreshes every 24 hours)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of stories to return (default: 10)',
  })
  @ApiOkResponse({
    description: 'List of random curated stories',
    type: StoryDto,
    isArray: true,
  })
  async getTopPicksFromUs(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.storyService.getTopPicksFromUs(Math.min(limit, 20));
  }
}
