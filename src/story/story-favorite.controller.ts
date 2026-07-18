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

import { ErrorResponseDto, FavoriteDto } from './dto/story.dto';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryFavoriteController {
  constructor(
    private readonly storyService: StoryService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

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
    await this.kidOwnership.getOwnedKidOrThrow(body.kidId, req.authUserData.userId);
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
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
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
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.storyService.getFavorites(kidId, safeCursor, safeLimit);
  }
}
