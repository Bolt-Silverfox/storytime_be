import { Controller, Post, Delete, Get, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { KidFavoritesService } from './kid-favorites.service';
import { AuthSessionGuard, AuthenticatedRequest } from '../../auth/auth.guard';

@ApiTags('Kid Favorites')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('api/v1/kids/:kidId/favorites')
export class KidFavoritesController {
  constructor(private readonly service: KidFavoritesService) {}

  @Post(':storyId')
  @ApiOperation({ summary: 'Add a story to kid favorites' })
  add(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.addFavorite(kidId, storyId, req.authUserData.userId);
  }

  @Delete(':storyId')
  @ApiOperation({ summary: 'Remove a story from kid favorites' })
  remove(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.removeFavorite(kidId, storyId, req.authUserData.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List kid favorites' })
  list(@Param('kidId') kidId: string, @Request() req: AuthenticatedRequest) {
    return this.service.listFavorites(kidId, req.authUserData.userId);
  }
}
