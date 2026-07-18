import {
  Body,
  Controller,
  Get,
  Logger,
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
  AssignDailyChallengeDto,
  CompleteDailyChallengeDto,
  DailyChallengeAssignmentDto,
  DailyChallengeDto,
  ErrorResponseDto,
} from './dto/story.dto';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';

@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories')
export class StoryDailyChallengeController {
  private readonly logger = new Logger(StoryDailyChallengeController.name);
  constructor(
    private readonly storyService: StoryService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

  // --- Daily Challenge ---
  @Post('daily-challenge')
  @ApiOperation({ summary: 'Set daily challenge' })
  @ApiBody({ type: DailyChallengeDto })
  async setDailyChallenge(@Body() body: DailyChallengeDto) {
    return this.storyService.setDailyChallenge(body);
  }

  @Get('daily-challenge')
  @ApiOperation({ summary: 'Get daily challenge for a date' })
  @ApiQuery({ name: 'date', required: true, type: String })
  async getDailyChallenge(@Query('date') date: string) {
    return this.storyService.getDailyChallenge(date);
  }

  // --- Daily Challenge Assignment ---
  @Post('daily-challenge/assign')
  @ApiOperation({ summary: 'Assign a daily challenge to a kid' })
  @ApiBody({ type: AssignDailyChallengeDto })
  @ApiResponse({ status: 201, type: DailyChallengeAssignmentDto })
  async assignDailyChallenge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AssignDailyChallengeDto,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(dto.kidId, req.authUserData.userId);
    return this.storyService.assignDailyChallenge(dto);
  }

  @Post('daily-challenge/complete')
  @ApiOperation({ summary: 'Mark a daily challenge assignment as completed' })
  @ApiBody({ type: CompleteDailyChallengeDto })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async completeDailyChallenge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CompleteDailyChallengeDto,
  ) {
    const assignment = await this.storyService.getAssignmentById(
      dto.assignmentId,
    );
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    await this.kidOwnership.getOwnedKidOrThrow(assignment.kidId, req.authUserData.userId);
    return this.storyService.completeDailyChallenge(dto);
  }

  @Get('daily-challenge/kid/:kidId')
  @ApiOperation({ summary: 'Get all daily challenge assignments for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  async getAssignmentsForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    return this.storyService.getAssignmentsForKid(kidId);
  }

  @Get('daily-challenge/assignment/:id')
  @ApiOperation({ summary: 'Get a daily challenge assignment by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async getAssignmentById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const assignment = await this.storyService.getAssignmentById(id);
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    await this.kidOwnership.getOwnedKidOrThrow(assignment.kidId, req.authUserData.userId);
    return assignment;
  }

  @Post('daily-challenge/assign-all')
  @ApiOperation({
    summary: 'Assign daily challenge to all kids (admin/manual trigger)',
  })
  @ApiOkResponse({ description: 'Daily challenges assigned to all kids.' })
  async assignDailyChallengeToAllKids() {
    await this.storyService.assignDailyChallengeToAllKids();
    return { message: 'Daily challenges assigned to all kids.' };
  }

  @Get('daily-challenge/today')
  @ApiOperation({ summary: "Get today's daily challenge assignment for a kid" })
  @ApiQuery({ name: 'kidId', required: true, type: String })
  @ApiOkResponse({
    description: "Today's daily challenge assignment",
    type: DailyChallengeAssignmentDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignment found',
    type: ErrorResponseDto,
  })
  async getTodaysDailyChallengeAssignment(
    @Req() req: AuthenticatedRequest,
    @Query('kidId') kidId: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    this.logger.log(
      `Getting today's daily challenge assignment for kid ${kidId}`,
    );
    return await this.storyService.getTodaysDailyChallengeAssignment(kidId);
  }

  @Get('daily-challenge/kid/:kidId/week')
  @ApiOperation({
    summary:
      'Get daily challenge assignments for a kid for a week (Sunday to Saturday)',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({
    name: 'weekStart',
    required: true,
    type: String,
    description: 'Start of the week (YYYY-MM-DD, must be a Sunday)',
  })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignments found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
    type: ErrorResponseDto,
  })
  async getWeeklyAssignmentsForKid(
    @Req() req: AuthenticatedRequest,
    @Param('kidId') kidId: string,
    @Query('weekStart') weekStart: string,
  ) {
    await this.kidOwnership.getOwnedKidOrThrow(kidId, req.authUserData.userId);
    const weekStartDate = new Date(weekStart);
    weekStartDate.setHours(0, 0, 0, 0);
    return this.storyService.getWeeklyDailyChallengeAssignments(
      kidId,
      weekStartDate,
    );
  }
}
