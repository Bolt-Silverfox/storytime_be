import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ScreenTimeService } from './services/screen-time.service';
import {
  WeeklyReportDto,
  KidDetailedReportDto,
  ScreenTimeSessionDto,
  EndScreenTimeSessionDto,
  DailyLimitDto,
} from './dto/reports.dto';
import { SubmitQuestionAnswerDto } from '../story/dto/story.dto';
import { OptionalAuth } from '@/shared/decorators/optional-auth.decorator';
import {
  AuthSessionGuard,
  OptionalAuthRequest,
} from '@/shared/guards/auth.guard';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly screenTimeService: ScreenTimeService,
  ) {}

  // ============== WEEKLY OVERVIEW ==============
  @Get('weekly/:parentId')
  @ApiOperation({ summary: 'Get weekly overview for all kids of a parent' })
  @ApiParam({ name: 'parentId', type: String })
  @ApiResponse({ status: 200, type: WeeklyReportDto })
  async getWeeklyOverview(@Param('parentId') parentId: string) {
    return this.reportsService.getWeeklyOverview(parentId);
  }

  // ============== KID DETAILED REPORT ==============
  @Get('kid/:kidId')
  @ApiOperation({ summary: 'Get detailed report for a specific kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: KidDetailedReportDto })
  async getKidReport(@Param('kidId') kidId: string) {
    return this.reportsService.getKidDetailedReport(kidId);
  }

  // ============== SCREEN TIME TRACKING ==============
  @Post('screen-time/start')
  @ApiOperation({ summary: 'Start a screen time session for a kid' })
  @ApiBody({ type: ScreenTimeSessionDto })
  @ApiResponse({ status: 201, description: 'Returns session ID' })
  async startScreenTime(@Body() dto: ScreenTimeSessionDto) {
    return this.screenTimeService.startScreenTimeSession(dto.kidId);
  }

  @Post('screen-time/end')
  @ApiOperation({ summary: 'End a screen time session' })
  @ApiBody({ type: EndScreenTimeSessionDto })
  @ApiResponse({ status: 200, description: 'Returns session duration' })
  async endScreenTime(@Body() dto: EndScreenTimeSessionDto) {
    return this.screenTimeService.endScreenTimeSession(dto.sessionId);
  }

  @Get('daily-limit/:kidId')
  @ApiOperation({ summary: 'Get daily limit status for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: DailyLimitDto })
  async getDailyLimitStatus(@Param('kidId') kidId: string) {
    return this.screenTimeService.getDailyLimitStatus(kidId);
  }

  // ============== QUIZ TRACKING ==============
  @Post('answer')
  @OptionalAuth()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record a question answer',
    description:
      'Attribution: pass kidId for kid-scoped answers (drives that kid’s ' +
      'badge progress), or omit it and authenticate to record a user-scoped ' +
      'answer. Guests (no auth, no kidId) get the correctness result back but ' +
      'nothing is persisted.',
  })
  @ApiBody({ type: SubmitQuestionAnswerDto })
  @ApiResponse({ status: 201, description: 'Returns if answer is correct' })
  async recordAnswer(
    @Req() req: OptionalAuthRequest,
    @Body() dto: SubmitQuestionAnswerDto,
  ) {
    return this.reportsService.recordAnswer(dto, req.authUserData?.userId);
  }
}
