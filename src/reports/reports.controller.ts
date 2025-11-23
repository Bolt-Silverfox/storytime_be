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
}
