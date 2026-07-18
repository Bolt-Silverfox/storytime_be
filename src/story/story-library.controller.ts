import {
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
  DownloadedStoryDto,
  StoryDto,
  StoryWithProgressDto,
} from './dto/story.dto';
import { PaginationUtil } from '@/shared/utils/pagination.util';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryLibraryController {
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
}
