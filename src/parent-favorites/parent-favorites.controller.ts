// src/parent-favorites/parent-favorites.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiOkResponse, ApiParam, ApiResponse } from '@nestjs/swagger';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { ParentFavoritesService } from './parent-favorites.service';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';
import { ErrorResponseDto } from '@/story/story.dto';

@ApiTags('parent-favorites')
@Controller('parent-favorites')
export class ParentFavoritesController {
  private readonly logger = new Logger(ParentFavoritesController.name);

  constructor(private readonly parentFavoritesService: ParentFavoritesService) { }

  @Post()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Add a story to parent favorites',
    description: 'Adds a story to the authenticated parent\'s list of favorites.',
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
    summary: 'Get all parent favorites',
    description: 'Retrieves all stories favorited by the authenticated parent.',
  })
  @ApiOkResponse({
    description: 'List of parent favorites retrieved successfully',
    type: ParentFavoriteResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getFavorites(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData.userId;
    this.logger.log(`Fetching favorites for parent ${userId}`);
    return this.parentFavoritesService.getFavorites(userId);
  }

  @Delete(':storyId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove a story from parent favorites',
    description: 'Removes a specific story from the authenticated parent\'s favorites.',
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
