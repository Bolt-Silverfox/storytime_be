import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

import { ErrorResponseDto, StoryProgressDto } from './dto/story.dto';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryProgressController {
  constructor(
    private readonly storyService: StoryService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

  // --- Progress ---
  @Post('progress')
  @ApiOperation({ summary: 'Set story progress' })
  @ApiBody({ type: StoryProgressDto })
  @ApiOkResponse({ description: 'Set progress', type: StoryProgressDto })
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
  async setProgress(
    @Req() req: AuthenticatedRequest,
    @Body() body: StoryProgressDto,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(
      body.kidId,
      req.authUserData.userId,
    );
    return this.storyService.setProgress(body);
  }

  @Get('progress/:kidId/:storyId')
  @ApiOperation({ summary: 'Get story progress' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Progress for story', type: StoryProgressDto })
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
  async getProgress(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    return this.storyService.getProgress(kidId, storyId);
  }
}
