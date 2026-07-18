import {
  Body,
  Controller,
  Get,
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
import { KidOwnershipService } from './services/kid-ownership.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryPathController {
  constructor(
    private readonly storyService: StoryService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

  // --- Story Path / Choice Tracking ---
  @Post('story-path/start')
  @ApiOperation({ summary: 'Start a story path for a kid' })
  @ApiBody({ type: StartStoryPathDto })
  @ApiResponse({ status: 201, type: StoryPathDto })
  async startStoryPath(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StartStoryPathDto,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(dto.kidId, req.authUserData.userId);
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
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
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
