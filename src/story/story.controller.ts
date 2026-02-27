import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  Param,
  Patch,
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
  AssignDailyChallengeDto,
  CategoryDto,
  CompleteDailyChallengeDto,
  CreateStoryDto,
  CursorPaginatedStoriesDto,
  DailyChallengeAssignmentDto,
  DailyChallengeDto,
  ErrorResponseDto,
  FavoriteDto,
  GenerateStoryDto,
  StartStoryPathDto,
  StoryBranchDto,
  StoryImageDto,
  StoryPathDto,
  StoryProgressDto,
  ThemeDto,
  UpdateStoryDto,
  UpdateStoryPathDto,
  PaginatedStoriesDto,
  DownloadedStoryDto,
  ParentRecommendationDto,
  RecommendationResponseDto,
  RecommendationsStatsDto,
  RestrictStoryDto,
  StoryDto,
  StoryWithProgressDto,
  TopPickStoryDto,
  UserStoryProgressDto,
  UserStoryProgressResponseDto,
} from './dto/story.dto';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import { StoryService } from './story.service';

import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import {
  StoryAccessGuard,
  RequestWithStoryAccess,
} from '@/shared/guards/story-access.guard';
import { CheckStoryQuota } from '@/shared/decorators/story-quota.decorator';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { StoryQuotaService } from './story-quota.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryController {
  private readonly logger = new Logger(StoryController.name);
  constructor(
    private readonly storyService: StoryService,
    private readonly storyQuotaService: StoryQuotaService,
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

  private async verifyStoryOwnership(
    storyId: string,
    userId: string,
    includeDeleted = false,
  ) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...(includeDeleted ? {} : { isDeleted: false }) },
      include: { creatorKid: { select: { parentId: true } } },
    });
    if (!story) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }
    if (story.creatorKidId && story.creatorKid?.parentId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to modify this story',
      );
    }
    return story;
  }

  @Get()
  @ApiOperation({
    summary:
      'Get stories (optionally filtered by theme, category, recommended, kidId, and age)',
  })
  @ApiQuery({ name: 'theme', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'season', required: false, type: String })
  @ApiQuery({ name: 'recommended', required: false, type: String })
  @ApiQuery({ name: 'isMostLiked', required: false, type: String })
  @ApiQuery({ name: 'isSeasonal', required: false, type: String })
  @ApiQuery({
    name: 'topPicksFromUs',
    required: false,
    type: String,
    description: 'Get random top picks from us',
  })
  @ApiQuery({ name: 'kidId', required: false, type: String })
  @ApiQuery({ name: 'age', required: false, type: String })
  @ApiQuery({ name: 'minAge', required: false, type: String })
  @ApiQuery({ name: 'maxAge', required: false, type: String })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Cursor for cursor-based pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of items to return for pagination',
  })
  @ApiOkResponse({
    description: 'List of stories',
    type: CreateStoryDto,
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
  @Throttle({
    long: { limit: THROTTLE_LIMITS.LONG.LIMIT, ttl: THROTTLE_LIMITS.LONG.TTL },
  }) // 100 per minute
  async getStories(
    @Req() req: AuthenticatedRequest,
    @Query('theme') theme?: string,
    @Query('category') category?: string,
    @Query('season') season?: string,
    @Query('recommended') recommended?: string,
    @Query('isMostLiked') isMostLiked?: string,
    @Query('isSeasonal') isSeasonal?: string,
    @Query('topPicksFromUs') topPicksFromUs?: string,
    @Query('kidId') kidId?: string,
    @Query('age') age?: string,
    @Query('minAge') minAge?: string,
    @Query('maxAge') maxAge?: string,
    @Query('cursor') cursor?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit') limitParam?: string,
  ): Promise<PaginatedStoriesDto | CursorPaginatedStoriesDto> {
    // Base filter shared by both pagination modes.
    // recommended and isMostLiked are intentionally excluded here
    // because they use orderings incompatible with cursor pagination,
    // and including them would leak into buildStoryWhereClause.
    const parsedAge = age ? Number(age) : undefined;
    if (parsedAge !== undefined && (!Number.isFinite(parsedAge) || parsedAge < 0)) {
      throw new BadRequestException('age must be a non-negative number');
    }
    const parsedMinAge = minAge ? Number(minAge) : undefined;
    if (parsedMinAge !== undefined && (!Number.isFinite(parsedMinAge) || parsedMinAge < 0)) {
      throw new BadRequestException('minAge must be a non-negative number');
    }
    const parsedMaxAge = maxAge ? Number(maxAge) : undefined;
    if (parsedMaxAge !== undefined && (!Number.isFinite(parsedMaxAge) || parsedMaxAge < 0)) {
      throw new BadRequestException('maxAge must be a non-negative number');
    }

    if (kidId) {
      await this.verifyKidOwnership(kidId, req.authUserData.userId);
    }

    const baseFilter = {
      userId: req.authUserData.userId,
      theme,
      category,
      season,
      isSeasonal: isSeasonal === 'true',
      kidId,
      age: parsedAge,
      minAge: parsedMinAge,
      maxAge: parsedMaxAge,
    };

    // Use cursor-based pagination when cursor param is present (even empty string).
    // The mobile cursor client always sends ?cursor= to signal intent.
    // topPicksFromUs (random), isMostLiked (aggregate count), and
    // recommended (special ordering) use orderings incompatible with
    // stable cursor pagination.
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limitParam);

    const useCursorMode =
      cursor !== undefined &&
      topPicksFromUs !== 'true' &&
      isMostLiked !== 'true' &&
      recommended !== 'true';

    if (cursor !== undefined && !useCursorMode) {
      this.logger.warn(
        `Cursor pagination ignored: cursor="${cursor}" bypassed because topPicksFromUs=${topPicksFromUs}, isMostLiked=${isMostLiked}, recommended=${recommended}. Falling back to offset pagination.`,
      );
    }

    if (useCursorMode) {
      return this.storyService.getStoriesCursor({
        ...baseFilter,
        cursor: safeCursor,
        limit: safeLimit,
      });
    }

    const limit = Math.max(1, Math.min(100, Number(limitParam) || 12));
    const safePage = Math.max(1, page);

    return this.storyService.getStories({
      ...baseFilter,
      recommended: recommended === 'true',
      isMostLiked: isMostLiked === 'true',
      topPicksFromUs: topPicksFromUs === 'true',
      page: safePage,
      limit,
    });
  }

  @Get('homepage/parent')
  @ApiOperation({
    summary: 'Get parent homepage stories (Recommended, Seasonal, Top Liked)',
  })
  @ApiResponse({
    status: 200,
    description: 'Homepage stories retrieved successfully.',
  })
  @ApiQuery({ name: 'limitRecommended', required: false, type: Number })
  @ApiQuery({ name: 'limitSeasonal', required: false, type: Number })
  @ApiQuery({ name: 'limitTopLiked', required: false, type: Number })
  async getParentHomepage(
    @Req() req: AuthenticatedRequest,
    @Query('limitRecommended', new DefaultValuePipe(5), ParseIntPipe)
    limitRecommended: number,
    @Query('limitSeasonal', new DefaultValuePipe(5), ParseIntPipe)
    limitSeasonal: number,
    @Query('limitTopLiked', new DefaultValuePipe(5), ParseIntPipe)
    limitTopLiked: number,
  ) {
    const safeLimitRecommended = Math.max(1, Math.min(limitRecommended, 50));
    const safeLimitSeasonal = Math.max(1, Math.min(limitSeasonal, 50));
    const safeLimitTopLiked = Math.max(1, Math.min(limitTopLiked, 50));
    return this.storyService.getHomePageStories(
      req.authUserData.userId,
      safeLimitRecommended,
      safeLimitSeasonal,
      safeLimitTopLiked,
    );
  }

  @Get('categories')
  @UseInterceptors(CacheInterceptor)
  @CacheKey('categories:all')
  @CacheTTL(4 * 60 * 60 * 1000)
  @ApiOperation({ summary: 'Get all categories' })
  @ApiOkResponse({
    description: 'List of categories',
    type: CategoryDto,
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
  async getCategories() {
    return this.storyService.getCategories();
  }

  @Get('themes')
  @ApiOperation({ summary: 'Get all themes' })
  @ApiOkResponse({
    description: 'List of themes',
    type: ThemeDto,
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
  async getThemes() {
    return this.storyService.getThemes();
  }

  @Get('seasons')
  @ApiOperation({ summary: 'Get all seasons' })
  @ApiOkResponse({
    description: 'List of seasons',
    type: ThemeDto, // Using ThemeDto struct or similar since SeasonDto is simple
    isArray: true,
  })
  async getSeasons() {
    return this.storyService.getSeasons();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new story' })
  @ApiBody({ type: CreateStoryDto })
  @ApiOkResponse({ description: 'Created story', type: CreateStoryDto })
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
  async createStory(@Body() body: CreateStoryDto) {
    return this.storyService.createStory(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateStoryDto })
  @ApiOkResponse({ description: 'Updated story', type: UpdateStoryDto })
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
  async updateStory(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateStoryDto,
  ) {
    await this.verifyStoryOwnership(id, req.authUserData.userId);
    return this.storyService.updateStory(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete the story (default: false - soft delete)',
  })
  @ApiOkResponse({ description: 'Deleted story', type: String })
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
  async deleteStory(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('permanent') permanent: boolean = false,
  ) {
    await this.verifyStoryOwnership(id, req.authUserData.userId, true);
    return this.storyService.deleteStory(id, permanent);
  }

  @Post(':id/undo-delete')
  @ApiOperation({ summary: 'Restore a soft deleted story' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({
    description: 'Story restored successfully',
    type: UpdateStoryDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Story is not deleted',
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
  async undoDeleteStory(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    await this.verifyStoryOwnership(id, req.authUserData.userId, true);
    return this.storyService.undoDeleteStory(id);
  }

  // --- Images ---
  @Post(':id/images')
  @ApiOperation({ summary: 'Add an image to a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: StoryImageDto })
  @ApiOkResponse({ description: 'Added image', type: StoryImageDto })
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
  async addImage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: StoryImageDto,
  ) {
    await this.verifyStoryOwnership(id, req.authUserData.userId);
    return this.storyService.addImage(id, body);
  }

  // --- Branches ---
  @Post(':id/branches')
  @ApiOperation({ summary: 'Add a branch to a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: StoryBranchDto })
  @ApiOkResponse({ description: 'Added branch', type: StoryBranchDto })
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
  async addBranch(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: StoryBranchDto,
  ) {
    await this.verifyStoryOwnership(id, req.authUserData.userId);
    return this.storyService.addBranch(id, body);
  }

  // --- Favorites ---
  @Post('favorites')
  @ApiOperation({ summary: 'Add a story to favorites' })
  @ApiBody({ type: FavoriteDto })
  @ApiOkResponse({ description: 'Added favorite', type: FavoriteDto })
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
  async addFavorite(
    @Req() req: AuthenticatedRequest,
    @Body() body: FavoriteDto,
  ) {
    await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
    return this.storyService.addFavorite(body);
  }

  @Delete('favorites/:kidId/:storyId')
  @ApiOperation({ summary: 'Remove a story from favorites' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Removed favorite', type: String })
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
  async removeFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.removeFavorite(kidId, storyId);
  }

  @Get('favorites/:kidId')
  @ApiOperation({ summary: 'Get kid favorites' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'List of favorites',
    type: FavoriteDto,
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
  async getFavorites(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getFavorites(kidId, safeCursor, safeLimit);
  }

  // === RESTRICTED STORIES ENDPOINTS ===

  @Post('/auth/restrict')
  @ApiOperation({ summary: 'Restrict a story for a specific kid' })
  @ApiBody({ type: RestrictStoryDto })
  async restrictStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: RestrictStoryDto,
  ) {
    await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
    return this.storyService.restrictStory({
      ...body,
      userId: req.authUserData.userId,
    });
  }

  @Delete('/auth/restrict/:kidId/:storyId')
  @ApiOperation({ summary: 'Unrestrict a story for a kid' })
  async unrestrictStory(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.unrestrictStory(
      kidId,
      storyId,
      req.authUserData.userId,
    );
  }

  @Get('/auth/restrict/:kidId')
  @ApiOperation({ summary: 'Get list of restricted stories for a kid' })
  async getRestrictedStories(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.getRestrictedStories(
      kidId,
      req.authUserData.userId,
    );
  }

  // --- Progress ---
  @Post('progress')
  @ApiOperation({ summary: 'Set story progress' })
  @ApiBody({ type: StoryProgressDto })
  @ApiOkResponse({ description: 'Set progress', type: StoryProgressDto })
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
  async setProgress(
    @Req() req: AuthenticatedRequest,
    @Body() body: StoryProgressDto,
  ) {
    await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
    return this.storyService.setProgress(body);
  }

  @Get('progress/:kidId/:storyId')
  @ApiOperation({ summary: 'Get story progress' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Progress for story', type: StoryProgressDto })
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
  async getProgress(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.getProgress(kidId, storyId);
  }

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

  // --- Daily Challenge ---
  @Post('daily-challenge')
  @ApiOperation({ summary: 'Set daily challenge' })
  @ApiBody({ type: DailyChallengeDto })
  async setDailyChallenge(@Body() body: DailyChallengeDto) {
    return this.storyService.setDailyChallenge(body);
  }

  @Get('daily-challenge')
  @ApiOperation({ summary: 'Get daily challenge for a date' })
  @ApiQuery({ name: 'date', required: true, type: String })
  async getDailyChallenge(@Query('date') date: string) {
    return this.storyService.getDailyChallenge(date);
  }

  // --- Daily Challenge Assignment ---
  @Post('daily-challenge/assign')
  @ApiOperation({ summary: 'Assign a daily challenge to a kid' })
  @ApiBody({ type: AssignDailyChallengeDto })
  @ApiResponse({ status: 201, type: DailyChallengeAssignmentDto })
  async assignDailyChallenge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AssignDailyChallengeDto,
  ) {
    await this.verifyKidOwnership(dto.kidId, req.authUserData.userId);
    return this.storyService.assignDailyChallenge(dto);
  }

  @Post('daily-challenge/complete')
  @ApiOperation({ summary: 'Mark a daily challenge assignment as completed' })
  @ApiBody({ type: CompleteDailyChallengeDto })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async completeDailyChallenge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CompleteDailyChallengeDto,
  ) {
    const assignment = await this.storyService.getAssignmentById(
      dto.assignmentId,
    );
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    await this.verifyKidOwnership(assignment.kidId, req.authUserData.userId);
    return this.storyService.completeDailyChallenge(dto);
  }

  @Get('daily-challenge/kid/:kidId')
  @ApiOperation({ summary: 'Get all daily challenge assignments for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  async getAssignmentsForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.getAssignmentsForKid(kidId);
  }

  @Get('daily-challenge/assignment/:id')
  @ApiOperation({ summary: 'Get a daily challenge assignment by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async getAssignmentById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const assignment = await this.storyService.getAssignmentById(id);
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    await this.verifyKidOwnership(assignment.kidId, req.authUserData.userId);
    return assignment;
  }

  @Post('daily-challenge/assign-all')
  @ApiOperation({
    summary: 'Assign daily challenge to all kids (admin/manual trigger)',
  })
  @ApiOkResponse({ description: 'Daily challenges assigned to all kids.' })
  async assignDailyChallengeToAllKids() {
    await this.storyService.assignDailyChallengeToAllKids();
    return { message: 'Daily challenges assigned to all kids.' };
  }

  @Get('daily-challenge/today')
  @ApiOperation({ summary: "Get today's daily challenge assignment for a kid" })
  @ApiQuery({ name: 'kidId', required: true, type: String })
  @ApiOkResponse({
    description: "Today's daily challenge assignment",
    type: DailyChallengeAssignmentDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignment found',
    type: ErrorResponseDto,
  })
  async getTodaysDailyChallengeAssignment(
    @Req() req: AuthenticatedRequest,
    @Query('kidId') kidId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    this.logger.log(
      `Getting today's daily challenge assignment for kid ${kidId}`,
    );
    return await this.storyService.getTodaysDailyChallengeAssignment(kidId);
  }

  @Get('daily-challenge/kid/:kidId/week')
  @ApiOperation({
    summary:
      'Get daily challenge assignments for a kid for a week (Sunday to Saturday)',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({
    name: 'weekStart',
    required: true,
    type: String,
    description: 'Start of the week (YYYY-MM-DD, must be a Sunday)',
  })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignments found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
    type: ErrorResponseDto,
  })
  async getWeeklyAssignmentsForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('weekStart') weekStart: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const weekStartDate = new Date(weekStart);
    weekStartDate.setHours(0, 0, 0, 0);
    return this.storyService.getWeeklyDailyChallengeAssignments(
      kidId,
      weekStartDate,
    );
  }

  // --- Story Path / Choice Tracking ---
  @Post('story-path/start')
  @ApiOperation({ summary: 'Start a story path for a kid' })
  @ApiBody({ type: StartStoryPathDto })
  @ApiResponse({ status: 201, type: StoryPathDto })
  async startStoryPath(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StartStoryPathDto,
  ) {
    await this.verifyKidOwnership(dto.kidId, req.authUserData.userId);
    return this.storyService.startStoryPath(dto);
  }

  @Patch('story-path/update')
  @ApiOperation({ summary: 'Update a story path (choices)' })
  @ApiBody({ type: UpdateStoryPathDto })
  @ApiResponse({ status: 200, type: StoryPathDto })
  async updateStoryPath(@Body() dto: UpdateStoryPathDto) {
    return this.storyService.updateStoryPath(dto);
  }

  @Get('story-path/kid/:kidId')
  @ApiOperation({ summary: 'Get all story paths for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [StoryPathDto] })
  async getStoryPathsForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.getStoryPathsForKid(kidId);
  }

  @Get('story-path/:id')
  @ApiOperation({ summary: 'Get a story path by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: StoryPathDto })
  async getStoryPathById(@Param('id') id: string) {
    return this.storyService.getStoryPathById(id);
  }

  @Post('generate')
  @UseGuards(SubscriptionThrottleGuard)
  @ApiOperation({ summary: 'Generate a story using AI' })
  @ApiBody({ type: GenerateStoryDto })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
  @Throttle({
    medium: {
      limit: THROTTLE_LIMITS.GENERATION.FREE.LIMIT,
      ttl: THROTTLE_LIMITS.GENERATION.FREE.TTL,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  async generateStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateStoryDto,
  ) {
    // If kidId is provided, use the specialized method
    if (body.kidId) {
      await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
      return this.storyService.generateStoryForKid(
        body.kidId,
        body.themes,
        body.categories,
        body.seasonIds,
        body.kidName,
      );
    }

    // Otherwise, generate with provided options
    const options = {
      theme: body.themes || ['Adventure'],
      category: body.categories || ['Bedtime Stories'],
      ageMin: body.ageMin || 4,
      ageMax: body.ageMax || 8,
      language: body.language || 'English',
      kidName: body.kidName,
      additionalContext: body.additionalContext,
      seasonIds: body.seasonIds,
    };

    return this.storyService.generateStoryWithAI(options);
  }

  @Post('generate/kid/:kidId')
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Generate a personalized story for a specific kid',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'theme', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
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
  async generateStoryForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('theme') theme?: string,
    @Query('category') category?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const themes = theme ? [theme] : undefined;
    const categories = category ? [category] : undefined;
    return this.storyService.generateStoryForKid(kidId, themes, categories);
  }

  @Get(':id')
  @UseGuards(StoryAccessGuard)
  @CheckStoryQuota()
  @ApiOperation({ summary: 'Get a story by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Story', type: CreateStoryDto })
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
  async getStoryById(
    @Param('id') id: string,
    @Req() req: RequestWithStoryAccess,
  ) {
    const story = await this.storyService.getStoryById(id);

    // Record access if this is a new story for the user
    if (
      req.authUserData?.userId &&
      req.storyAccessResult?.reason !== 'already_read' &&
      req.storyAccessResult?.reason !== 'kid_created'
    ) {
      await this.storyQuotaService.recordNewStoryAccess(
        req.authUserData.userId,
        id,
      );
    }

    return story;
  }

  // --- LIBRARY ENDPOINTS ---

  @Get('library/:kidId/continue-reading')
  @ApiOperation({ summary: 'Get stories currently in progress' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: [StoryWithProgressDto] })
  async getContinueReading(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getContinueReading(kidId, safeCursor, safeLimit);
  }

  @Get('library/:kidId/completed')
  @ApiOperation({ summary: 'Get completed stories history' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: [StoryDto] })
  async getCompleted(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getCompletedStories(kidId, safeCursor, safeLimit);
  }

  @Get('library/:kidId/created')
  @ApiOperation({ summary: 'Get stories created by the kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: [StoryDto] })
  async getCreated(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getCreatedStories(kidId, safeCursor, safeLimit);
  }

  @Get('library/:kidId/downloads')
  @ApiOperation({ summary: 'Get downloaded stories' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: [StoryDto] })
  async getDownloads(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getDownloads(kidId, safeCursor, safeLimit);
  }

  @Post('library/:kidId/download/:storyId')
  @ApiOperation({ summary: 'Mark a story as downloaded' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiResponse({ status: 201, type: DownloadedStoryDto })
  async addDownload(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.addDownload(kidId, storyId);
  }

  @Delete('library/:kidId/download/:storyId')
  @ApiOperation({ summary: 'Remove a story from downloads' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiResponse({ status: 200, type: DownloadedStoryDto })
  async removeDownload(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    return this.storyService.removeDownload(kidId, storyId);
  }

  @Delete('library/:kidId/remove/:storyId')
  @ApiOperation({
    summary: 'Remove from library (Resets progress, favs, downloads)',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Story removed from library successfully',
  })
  async removeFromLibrary(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    await this.storyService.removeFromLibrary(kidId, storyId);
    return { message: 'Story removed from library successfully' };
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
