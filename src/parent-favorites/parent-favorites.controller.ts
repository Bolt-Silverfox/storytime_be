// src/parent-favorites/parent-favorites.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { ParentFavoritesService } from './parent-favorites.service';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';
import { ErrorResponseDto } from '@/story/dto/story.dto';

@ApiTags('parent-favorites')
@Controller('parent-favorites')
export class ParentFavoritesController {
  private readonly logger = new Logger(ParentFavoritesController.name);

  constructor(
    private readonly parentFavoritesService: ParentFavoritesService,
  ) {}

  @Post()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add a story to parent favorites',
    description:
      "Adds a story to the authenticated parent's list of favorites.",
  })
  @ApiBody({
    type: CreateParentFavoriteDto,
    examples: {
      example1: {
        summary: 'Add story to favorites',
        value: {
          storyId: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Story successfully added to favorites',
    type: ParentFavoriteResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid input or story not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
    type: ErrorResponseDto,
  })
  async addFavorite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateParentFavoriteDto,
  ) {
    const userId = req.authUserData.userId;
    this.logger.log(
      `Adding favorite for parent ${userId} and story ${dto.storyId}`,
    );
    return this.parentFavoritesService.addFavorite(userId, dto);
  }

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get parent favorites with cursor pagination',
    description:
      'Retrieves stories favorited by the authenticated parent, paginated via cursor.',
  })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Paginated list of parent favorites',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/ParentFavoriteResponseDto' },
        },
        pagination: {
          type: 'object',
          properties: {
            nextCursor: { type: 'string', nullable: true },
            hasNextPage: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getFavorites(
    @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.authUserData.userId;
    this.logger.log(`Fetching favorites for parent ${userId}`);
    const { cursor: safeCursor, limit: safeLimit } =
      PaginationUtil.sanitizeCursorParams(cursor, limit);
    return this.parentFavoritesService.getFavorites(
      userId,
      safeCursor,
      safeLimit,
    );
  }

  @Delete(':storyId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove a story from parent favorites',
    description:
      "Removes a specific story from the authenticated parent's favorites.",
  })
  @ApiParam({
    name: 'storyId',
    type: String,
    description: 'ID of the story to remove from favorites',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @ApiOkResponse({
    description: 'Story successfully removed from favorites',
    schema: {
      type: 'string',
      example: 'Favorite removed successfully',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Favorite not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async removeFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ) {
    const userId = req.authUserData.userId;
    this.logger.log(
      `Removing favorite for parent ${userId} and story ${storyId}`,
    );
    return this.parentFavoritesService.removeFavorite(userId, storyId);
  }
}
