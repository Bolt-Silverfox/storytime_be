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
  CategoryDto,
  CreateStoryDto,
  CursorPaginatedStoriesDto,
  ErrorResponseDto,
  StoryBranchDto,
  StoryImageDto,
  ThemeDto,
  UpdateStoryDto,
  PaginatedStoriesDto,
} from './dto/story.dto';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import { StoryService } from './story.service';

import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryCoreController {
  private readonly logger = new Logger(StoryCoreController.name);
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
    if (!story.creatorKidId || story.creatorKid?.parentId !== userId) {
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
  @ApiQuery({
    name: 'shuffle',
    required: false,
    type: String,
    description: 'Shuffle unseen stories for variety on home screen sections',
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
    @Query('shuffle') shuffle?: string,
  ): Promise<PaginatedStoriesDto | CursorPaginatedStoriesDto> {
    // Base filter shared by both pagination modes.
    // recommended and isMostLiked are intentionally excluded here
    // because they use orderings incompatible with cursor pagination,
    // and including them would leak into buildStoryWhereClause.
    const parsedAge = age ? Number(age) : undefined;
    if (
      parsedAge !== undefined &&
      (!Number.isFinite(parsedAge) || parsedAge < 0)
    ) {
      throw new BadRequestException('age must be a non-negative number');
    }
    const parsedMinAge = minAge ? Number(minAge) : undefined;
    if (
      parsedMinAge !== undefined &&
      (!Number.isFinite(parsedMinAge) || parsedMinAge < 0)
    ) {
      throw new BadRequestException('minAge must be a non-negative number');
    }
    const parsedMaxAge = maxAge ? Number(maxAge) : undefined;
    if (
      parsedMaxAge !== undefined &&
      (!Number.isFinite(parsedMaxAge) || parsedMaxAge < 0)
    ) {
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
      recommended !== 'true' &&
      shuffle !== 'true';

    if (cursor !== undefined && !useCursorMode) {
      this.logger.warn(
        `Cursor pagination ignored: cursor="${cursor}" bypassed because topPicksFromUs=${topPicksFromUs}, isMostLiked=${isMostLiked}, recommended=${recommended}, shuffle=${shuffle}. Falling back to offset pagination.`,
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
      shuffle: shuffle === 'true',
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
}
