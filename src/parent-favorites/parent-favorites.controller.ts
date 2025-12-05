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
import { ParentFavoriteDto } from './dto/parent-favorite.dto';
import { ErrorResponseDto } from '@/story/story.dto';

@ApiTags('parent-favorites')
@Controller('parent-favorites')
export class ParentFavoritesController {
  private readonly logger = new Logger(ParentFavoritesController.name);

  constructor(private readonly parentFavoritesService: ParentFavoritesService) {}

  @Post()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a story to parent favorites' })
  @ApiBody({ type: CreateParentFavoriteDto })
  @ApiOkResponse({ description: 'Added favorite', type: ParentFavoriteDto })
  @ApiResponse({ status: 400, description: 'Bad Request', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  async addFavorite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateParentFavoriteDto,
  ) {
    const userId = req.authUserData.userId;
    this.logger.log(`Adding favorite for parent ${userId} and story ${dto.storyId}`);
    return this.parentFavoritesService.addFavorite(userId, dto);
  }

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all parent favorites' })
  @ApiOkResponse({ description: 'List of parent favorites', type: ParentFavoriteDto, isArray: true })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  async getFavorites(@Req() req: AuthenticatedRequest) {
    const userId = req.authUserData.userId;
    this.logger.log(`Fetching favorites for parent ${userId}`);
    return this.parentFavoritesService.getFavorites(userId);
  }

  @Delete(':storyId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a story from parent favorites' })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Removed favorite', type: String })
  @ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
  async removeFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ) {
    const userId = req.authUserData.userId;
    this.logger.log(`Removing favorite for parent ${userId} and story ${storyId}`);
    return this.parentFavoritesService.removeFavorite(userId, storyId);
  }
}
