import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';

import { CreateStoryDto, ErrorResponseDto } from './dto/story.dto';
import { StoryService } from './story.service';

import {
  StoryAccessGuard,
  RequestWithStoryAccess,
} from '@/shared/guards/story-access.guard';
import { CheckStoryQuota } from '@/shared/decorators/story-quota.decorator';
import { StoryQuotaService } from './story-quota.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryReadController {
  constructor(
    private readonly storyService: StoryService,
    private readonly storyQuotaService: StoryQuotaService,
  ) {}

  @Get(':id')
  @UseGuards(StoryAccessGuard)
  @CheckStoryQuota()
  @ApiOperation({ summary: 'Get a story by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Story', type: CreateStoryDto })
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
    status: 403,
    description: 'Story limit reached',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getStoryById(
    @Param('id') id: string,
    @Req() req: RequestWithStoryAccess,
  ) {
    const story = await this.storyService.getStoryById(id);

    // Record access if this is a new story for the user
    if (
      req.authUserData?.userId &&
      req.storyAccessResult?.reason !== 'already_read' &&
      req.storyAccessResult?.reason !== 'kid_created'
    ) {
      await this.storyQuotaService.recordNewStoryAccess(
        req.authUserData.userId,
        id,
      );
    }

    return story;
  }
}
