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
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryFavoriteController {
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
}
