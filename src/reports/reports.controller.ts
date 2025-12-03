import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import {
  WeeklyReportDto,
  KidDetailedReportDto,
  ScreenTimeSessionDto,
  EndScreenTimeSessionDto,
  DailyLimitDto,
} from './reports.dto';
import { QuestionAnswerDto } from '../story/story.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

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
    return this.reportsService.startScreenTimeSession(dto.kidId);
  }

  @Post('screen-time/end')
  @ApiOperation({ summary: 'End a screen time session' })
  @ApiBody({ type: EndScreenTimeSessionDto })
  @ApiResponse({ status: 200, description: 'Returns session duration' })
  async endScreenTime(@Body() dto: EndScreenTimeSessionDto) {
    return this.reportsService.endScreenTimeSession(dto.sessionId);
  }

  @Get('daily-limit/:kidId')
  @ApiOperation({ summary: 'Get daily limit status for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: DailyLimitDto })
  async getDailyLimitStatus(@Param('kidId') kidId: string) {
    return this.reportsService.getDailyLimitStatus(kidId);
  }

  // ============== QUIZ TRACKING ==============
  @Post('answer')
  @ApiOperation({ summary: 'Record a question answer' })
  @ApiBody({ type: QuestionAnswerDto })
  @ApiResponse({ status: 201, description: 'Returns if answer is correct' })
  async recordAnswer(@Body() dto: QuestionAnswerDto) {
    return this.reportsService.recordAnswer(dto);
  }

  // ============== NEW FEATURES - CUSTOM DATE RANGE ==============
  @Get('custom-range/:kidId/:startDate/:endDate')
  @ApiOperation({ summary: 'Get report for a kid within a custom date range' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'startDate', type: String, description: 'ISO date string' })
  @ApiParam({ name: 'endDate', type: String, description: 'ISO date string' })
  @ApiResponse({ status: 200, description: 'Custom range report' })
  async getCustomRangeReport(
    @Param('kidId') kidId: string,
    @Param('startDate') startDate: string,
    @Param('endDate') endDate: string,
  ) {
    return this.reportsService.getCustomRangeReport(
      kidId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  // ============== NEW FEATURES - DAILY BREAKDOWN ==============
  @Get('daily-breakdown/:kidId')
  @ApiOperation({ summary: 'Get daily breakdown for a kid for the current week' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, description: 'Daily breakdown for the week' })
  async getDailyBreakdown(@Param('kidId') kidId: string) {
    return this.reportsService.getDailyBreakdown(kidId);
  }

  @Get('daily-breakdown/:kidId/:weekStart')
  @ApiOperation({ summary: 'Get daily breakdown for a kid for a specific week' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'weekStart', type: String, description: 'ISO date string for week start' })
  @ApiResponse({ status: 200, description: 'Daily breakdown for the week' })
  async getDailyBreakdownForWeek(
    @Param('kidId') kidId: string,
    @Param('weekStart') weekStart: string,
  ) {
    return this.reportsService.getDailyBreakdown(kidId, new Date(weekStart));
  }

  // ============== NEW FEATURES - ACTIVITY CATEGORIES ==============
  @Get('activity-categories/:kidId/:startDate/:endDate')
  @ApiOperation({ summary: 'Get activity breakdown by category for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'startDate', type: String, description: 'ISO date string' })
  @ApiParam({ name: 'endDate', type: String, description: 'ISO date string' })
  @ApiResponse({ status: 200, description: 'Activity categories breakdown' })
  async getActivityCategories(
    @Param('kidId') kidId: string,
    @Param('startDate') startDate: string,
    @Param('endDate') endDate: string,
  ) {
    return this.reportsService.getActivityCategories(
      kidId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  // ============== NEW FEATURES - WEEK-OVER-WEEK COMPARISON ==============
  @Get('week-comparison/:kidId')
  @ApiOperation({ summary: 'Get week-over-week comparison for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, description: 'Week-over-week comparison metrics' })
  async getWeekComparison(@Param('kidId') kidId: string) {
    return this.reportsService.getWeekComparison(kidId);
  }

  // ============== NEW FEATURES - QUIZ ACCURACY TRENDS ==============
  @Get('quiz-trends/:kidId')
  @ApiOperation({ summary: 'Get quiz accuracy trends for a kid (last 4 weeks)' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, description: 'Quiz accuracy trends' })
  async getQuizTrends(@Param('kidId') kidId: string) {
    return this.reportsService.getQuizTrends(kidId);
  }

  @Get('quiz-trends/:kidId/:weeksCount')
  @ApiOperation({ summary: 'Get quiz accuracy trends for a kid (custom weeks count)' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'weeksCount', type: Number })
  @ApiResponse({ status: 200, description: 'Quiz accuracy trends' })
  async getQuizTrendsCustom(
    @Param('kidId') kidId: string,
    @Param('weeksCount') weeksCount: string,
  ) {
    return this.reportsService.getQuizTrends(kidId, parseInt(weeksCount));
  }
}
