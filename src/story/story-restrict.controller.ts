import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

import { RestrictStoryDto } from './dto/story.dto';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryRestrictController {
  constructor(
    private readonly storyService: StoryService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

  // === RESTRICTED STORIES ENDPOINTS ===

  @Post('/auth/restrict')
  @ApiOperation({ summary: 'Restrict a story for a specific kid' })
  @ApiBody({ type: RestrictStoryDto })
  async restrictStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: RestrictStoryDto,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(
      body.kidId,
      req.authUserData.userId,
    );
    return this.storyService.restrictStory({
      ...body,
      userId: req.authUserData.userId,
    });
  }

  @Delete('/auth/restrict/:kidId/:storyId')
  @ApiOperation({ summary: 'Unrestrict a story for a kid' })
  async unrestrictStory(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    return this.storyService.unrestrictStory(
      kidId,
      storyId,
      req.authUserData.userId,
    );
  }

  @Get('/auth/restrict/:kidId')
  @ApiOperation({ summary: 'Get list of restricted stories for a kid' })
  async getRestrictedStories(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    return this.storyService.getRestrictedStories(
      kidId,
      req.authUserData.userId,
    );
  }
}
