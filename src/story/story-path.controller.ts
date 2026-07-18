import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

import {
  StartStoryPathDto,
  StoryPathDto,
  UpdateStoryPathDto,
} from './dto/story.dto';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryPathController {
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
}
