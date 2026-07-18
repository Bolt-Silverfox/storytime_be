import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
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
  CreateStoryDto,
  ErrorResponseDto,
  GenerateStoryDto,
} from './dto/story.dto';
import { StoryService } from './story.service';

import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryGenerateController {
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

  @Post('generate')
  @UseGuards(SubscriptionThrottleGuard)
  @ApiOperation({ summary: 'Generate a story using AI' })
  @ApiBody({ type: GenerateStoryDto })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
  @Throttle({
    medium: {
      limit: THROTTLE_LIMITS.GENERATION.FREE.LIMIT,
      ttl: THROTTLE_LIMITS.GENERATION.FREE.TTL,
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  async generateStory(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateStoryDto,
  ) {
    // If kidId is provided, use the specialized method
    if (body.kidId) {
      await this.verifyKidOwnership(body.kidId, req.authUserData.userId);
      return this.storyService.generateStoryForKid(
        body.kidId,
        body.themes,
        body.categories,
        body.seasonIds,
        body.kidName,
      );
    }

    // Otherwise, generate with provided options
    const options = {
      theme: body.themes || ['Adventure'],
      category: body.categories || ['Bedtime Stories'],
      ageMin: body.ageMin || 4,
      ageMax: body.ageMax || 8,
      language: body.language || 'English',
      kidName: body.kidName,
      additionalContext: body.additionalContext,
      seasonIds: body.seasonIds,
    };

    return this.storyService.generateStoryWithAI(options);
  }

  @Post('generate/kid/:kidId')
  @Throttle({ short: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Generate a personalized story for a specific kid',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'theme', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
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
  async generateStoryForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('theme') theme?: string,
    @Query('category') category?: string,
  ) {
    await this.verifyKidOwnership(kidId, req.authUserData.userId);
    const themes = theme ? [theme] : undefined;
    const categories = category ? [category] : undefined;
    return this.storyService.generateStoryForKid(kidId, themes, categories);
  }
}
