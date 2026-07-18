import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
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
  StoryDto,
  StoryWithProgressDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import { StoryService } from './story.service';

import {
  StoryAccessGuard,
  RequestWithStoryAccess,
} from '@/shared/guards/story-access.guard';
import { CheckStoryQuota } from '@/shared/decorators/story-quota.decorator';
import { StoryQuotaService } from './story-quota.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryUserController {
  constructor(
    private readonly storyService: StoryService,
    private readonly storyQuotaService: StoryQuotaService,
  ) {}

  // --- USER STORY PROGRESS (Parent/User - non-kid specific) ---

  @Post('user/progress')
  @UseGuards(StoryAccessGuard)
  @CheckStoryQuota()
  @ApiOperation({
    summary: 'Record story progress for authenticated user (parent account)',
  })
  @ApiBody({ type: UserStoryProgressDto })
  @ApiOkResponse({
    description: 'Progress recorded',
    type: UserStoryProgressResponseDto,
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
    status: 403,
    description: 'Story limit reached',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async setUserProgress(
    @Req() req: RequestWithStoryAccess,
    @Body() body: UserStoryProgressDto,
  ) {
    // Execute the operation first, then record quota on success
    const result = await this.storyService.setUserProgress(
      req.authUserData!.userId,
      body,
    );

    // Record access only after successful operation to avoid consuming quota on failures
    if (
      req.authUserData?.userId &&
      req.storyAccessResult?.reason !== 'already_read' &&
      req.storyAccessResult?.reason !== 'kid_created'
    ) {
      await this.storyQuotaService.recordNewStoryAccess(
        req.authUserData.userId,
        body.storyId,
      );
    }

    return result;
  }

  @Get('user/progress/:storyId')
  @ApiOperation({ summary: 'Get story progress for authenticated user' })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({
    description: 'Progress for story',
    type: UserStoryProgressResponseDto,
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
  async getUserProgress(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ) {
    return this.storyService.getUserProgress(req.authUserData.userId, storyId);
  }

  @Get('user/library/continue-reading')
  @ApiOperation({ summary: 'Get in-progress stories for authenticated user' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'List of in-progress stories',
    type: StoryWithProgressDto,
    isArray: true,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getUserContinueReading(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getUserContinueReading(
      req.authUserData.userId,
      safeCursor,
      safeLimit,
    );
  }

  @Get('user/library/completed')
  @ApiOperation({ summary: 'Get completed stories for authenticated user' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'List of completed stories',
    type: StoryDto,
    isArray: true,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getUserCompletedStories(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getUserCompletedStories(
      req.authUserData.userId,
      safeCursor,
      safeLimit,
    );
  }

  @Delete('user/library/remove/:storyId')
  @ApiOperation({
    summary: 'Remove story from user library (resets progress and favorites)',
  })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Story removed from library successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async removeFromUserLibrary(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ) {
    await this.storyService.removeFromUserLibrary(
      req.authUserData.userId,
      storyId,
    );
    return { message: 'Story removed from library successfully' };
  }

  @Get('user/quota')
  @ApiOperation({ summary: 'Get story quota status for authenticated user' })
  @ApiOkResponse({
    description: 'Quota status',
    schema: {
      type: 'object',
      properties: {
        isPremium: { type: 'boolean' },
        unlimited: { type: 'boolean' },
        used: { type: 'number' },
        baseLimit: { type: 'number' },
        bonusStories: { type: 'number' },
        totalAllowed: { type: 'number' },
        remaining: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getQuotaStatus(@Req() req: AuthenticatedRequest) {
    return this.storyQuotaService.getQuotaStatus(req.authUserData.userId);
  }
}
