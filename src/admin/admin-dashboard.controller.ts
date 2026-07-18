import {
  Controller,
  Get,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminService } from './admin.service';
import { AdminSystemService } from './admin-system.service';
import { Admin } from './decorators/admin.decorator';
import { DateRangeDto } from './dto/admin-filters.dto';
import { ExportAnalyticsDto } from './dto/admin-export.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
import {
  DashboardStatsDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
} from './dto/admin-responses.dto';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminDashboardController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminSystemService: AdminSystemService,
  ) {}

  // =====================
  // DASHBOARD & ANALYTICS
  // =====================

  @Get('dashboard/stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get dashboard metrics',
    description:
      'Returns comprehensive platform KPIs including users, stories, subscriptions, and revenue statistics.',
  })
  @ApiOkResponse({
    description: 'Dashboard metrics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Dashboard metrics retrieved successfully',
        data: {
          totalUsers: 1250,
          totalParents: 800,
          totalKids: 450,
          totalAdmins: 5,
          totalStories: 325,
          totalCategories: 20,
          totalThemes: 18,
          activeUsers24h: 120,
          activeUsers7d: 350,
          newUsersToday: 15,
          newUsersThisWeek: 85,
          newUsersThisMonth: 220,
          totalStoryViews: 12500,
          totalFavorites: 2300,
          averageSessionTime: 15,
          paidUsers: 180,
          unpaidUsers: 1070,
          totalSubscriptions: 200,
          activeSubscriptions: 180,
          subscriptionPlans: [
            { plan: 'monthly', count: 120 },
            { plan: 'yearly', count: 60 },
            { plan: 'family', count: 20 },
          ],
          totalRevenue: 12500.5,
          conversionRate: 14.4,
        },
      },
    },
  })
  async getDashboardStats(): Promise<DashboardStatsDto> {
    const stats = await this.adminService.getDashboardStats();
    return {
      statusCode: 200,
      message: 'Dashboard metrics retrieved successfully',
      data: stats,
    } as any;
  }

  @Get('dashboard/user-growth')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user growth analytics',
    description:
      'Returns day-by-day user growth statistics with paid/unpaid breakdown between optional startDate/endDate.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31',
  })
  @ApiOkResponse({
    description: 'User growth analytics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User growth analytics retrieved successfully',
        data: [
          {
            date: '2023-10-01',
            newUsers: 10,
            paidUsers: 2,
            totalUsers: 1000,
            totalPaidUsers: 150,
          },
          {
            date: '2023-10-02',
            newUsers: 8,
            paidUsers: 1,
            totalUsers: 1008,
            totalPaidUsers: 151,
          },
        ],
      },
    },
  })
  async getUserGrowth(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getUserGrowth(dateRange);
    return {
      statusCode: 200,
      message: 'User growth analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/subscription-analytics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get subscription analytics',
    description:
      'Returns detailed subscription metrics including growth, revenue, plan breakdown, and churn rate.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31',
  })
  @ApiOkResponse({
    description: 'Subscription analytics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Subscription analytics retrieved successfully',
        data: {
          subscriptionGrowth: [
            { date: '2023-10-01', count: 5 },
            { date: '2023-10-02', count: 3 },
          ],
          revenueGrowth: [
            { date: '2023-10-01', amount: 500 },
            { date: '2023-10-02', amount: 300 },
          ],
          planBreakdown: [
            { plan: 'monthly', count: 120 },
            { plan: 'yearly', count: 60 },
            { plan: 'family', count: 20 },
          ],
          churnRate: 2.5,
        },
      },
    },
  })
  async getSubscriptionAnalytics(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getSubscriptionAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Subscription analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/revenue-analytics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get revenue analytics',
    description:
      'Returns detailed revenue breakdown by day, month, year, and top subscription plans.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31',
  })
  @ApiOkResponse({
    description: 'Revenue analytics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Revenue analytics retrieved successfully',
        data: {
          dailyRevenue: [
            { date: '2023-10-01', amount: 500 },
            { date: '2023-10-02', amount: 750 },
          ],
          monthlyRevenue: [
            { month: '2023-10', total_amount: 12500 },
            { month: '2023-09', total_amount: 11800 },
          ],
          yearlyRevenue: [
            { year: '2023', total_amount: 85000 },
            { year: '2022', total_amount: 72000 },
          ],
          topPlans: [
            {
              plan: 'yearly',
              subscription_count: 60,
              total_revenue: 6000,
            },
            {
              plan: 'monthly',
              subscription_count: 120,
              total_revenue: 4800,
            },
          ],
        },
      },
    },
  })
  async getRevenueAnalytics(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getRevenueAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Revenue analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/story-stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get story statistics',
    description:
      'Returns comprehensive story metrics including counts, AI-generated stories, recommendations, and engagement.',
  })
  @ApiOkResponse({
    description: 'Story statistics retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story statistics retrieved successfully',
        data: {
          totalStories: 325,
          publishedStories: 325,
          draftStories: 0,
          aiGeneratedStories: 150,
          recommendedStories: 75,
          deletedStories: 15,
          totalViews: 12500,
          totalFavorites: 2300,
        },
      },
    },
  })
  async getStoryStats(): Promise<StoryStatsDto> {
    const stats = await this.adminService.getStoryStats();
    return {
      statusCode: 200,
      message: 'Story statistics retrieved successfully',
      data: stats,
    } as any;
  }

  @Get('dashboard/content-breakdown')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get content breakdown',
    description:
      'Returns content distribution by language, age group, category, and theme.',
  })
  @ApiOkResponse({
    description: 'Content breakdown retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Content breakdown retrieved successfully',
        data: {
          byLanguage: [
            { language: 'English', count: 250 },
            { language: 'Spanish', count: 50 },
            { language: 'French', count: 25 },
          ],
          byAgeGroup: [
            { ageRange: '3-5', count: 100 },
            { ageRange: '6-8', count: 150 },
            { ageRange: '9-12', count: 75 },
          ],
          byCategory: [
            { categoryName: 'Animal Stories', count: 80 },
            { categoryName: 'Adventure & Action', count: 70 },
            { categoryName: 'Bedtime Stories', count: 60 },
          ],
          byTheme: [
            { themeName: 'Adventure', count: 120 },
            { themeName: 'Friendship', count: 90 },
            { themeName: 'Courage', count: 70 },
          ],
        },
      },
    },
  })
  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    const breakdown = await this.adminService.getContentBreakdown();
    return {
      statusCode: 200,
      message: 'Content breakdown retrieved successfully',
      data: breakdown,
    } as any;
  }

  @Get('dashboard/system-health')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get system health status',
    description:
      'Returns system health metrics including database connectivity, response time, uptime, and memory utilization.',
  })
  @ApiOkResponse({
    description: 'System health status retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'System health status retrieved successfully',
        data: {
          status: 'healthy',
          database: {
            connected: true,
            responseTime: 45,
          },
          uptime: 86400,
          memoryUsage: {
            used: 512,
            total: 1024,
            percentage: 50,
          },
          timestamp: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  async getSystemHealth(): Promise<SystemHealthDto> {
    const health = await this.adminService.getSystemHealth();
    return {
      statusCode: 200,
      message: 'System health status retrieved successfully',
      data: health,
    } as any;
  }

  @Get('dashboard/recent-activity')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recent activity logs',
    description: 'Returns recent system activity logs with user information.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of activity logs to return (default: 50, max: 100)',
    example: 50,
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Filter activity logs by a specific user ID',
    example: 'user-123',
  })
  @ApiOkResponse({
    description: 'Recent activity logs retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Recent activity logs retrieved successfully',
        data: [
          {
            id: 'activity-123',
            userId: 'user-123',
            kidId: 'kid-123',
            action: 'STORY_READ',
            status: 'SUCCESS',
            deviceName: 'iPhone 13',
            deviceModel: 'A2482',
            os: 'iOS 17',
            ipAddress: '192.168.1.100',
            details: 'Read story: The Magic Forest',
            createdAt: '2023-10-15T10:30:00Z',
            user: {
              id: 'user-123',
              email: 'parent@example.com',
              name: 'John Doe',
              role: 'parent',
            },
            kid: {
              id: 'kid-123',
              name: 'Emma Doe',
            },
          },
        ],
      },
    },
  })
  async getRecentActivity(
    @Query('limit') limit?: number,
    @Query('userId') userId?: string,
  ) {
    const { limit: l } = PaginationUtil.sanitize(1, limit, 100);
    const trimmedUserId = userId?.trim() || undefined;
    const data = await this.adminSystemService.getRecentActivity(
      l,
      trimmedUserId,
    );
    return {
      statusCode: 200,
      message: 'Recent activity logs retrieved successfully',
      data,
    };
  }

  @Get('dashboard/ai-credits')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get AI credit analytics',
    description:
      'Returns usage stats for AI services (ElevenLabs, Gemini), grouped by the selected duration (daily/weekly/monthly/quarterly/yearly).',
  })
  @ApiOkResponse({
    description: 'AI credit analytics retrieved successfully',
  })
  async getAiCreditStats(
    @Query('duration')
    duration: string = 'yearly',
  ) {
    const valid = ['yearly', 'quarterly', 'monthly', 'weekly', 'daily'];
    if (!valid.includes(duration)) {
      throw new BadRequestException(
        `Invalid duration. Must be one of: ${valid.join(', ')}`,
      );
    }
    const data = await this.adminService.getAiCreditAnalytics(
      duration as 'yearly' | 'quarterly' | 'monthly' | 'weekly' | 'daily',
    );
    return {
      statusCode: 200,
      message: 'AI credit analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/user-growth-monthly')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get monthly user growth (Free vs Paid)',
    description:
      'Returns user growth data for the selected duration (last_week/last_month/last_year), split by subscription status',
  })
  @ApiOkResponse({
    description: 'User growth data retrieved successfully',
  })
  async getUserGrowthMonthly(
    @Query('duration')
    duration: string = 'last_year',
  ) {
    const valid = ['last_year', 'last_month', 'last_week'];
    if (!valid.includes(duration)) {
      throw new BadRequestException(
        `Invalid duration. Must be one of: ${valid.join(', ')}`,
      );
    }
    const data = await this.adminService.getUserGrowthMonthly(
      duration as 'last_year' | 'last_month' | 'last_week',
    );
    return {
      statusCode: 200,
      message: 'User growth data retrieved successfully',
      data: data.data,
    };
  }

  // =====================
  // EXPORT ENDPOINTS
  // =====================

  @Get('dashboard/export')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Export analytics data',
    description:
      'Export analytics data (users, revenue, subscriptions) as CSV or JSON.',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: ['users', 'revenue', 'subscriptions'],
    description: 'Type of analytics data to export',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'json'],
    description: 'Export format (default: csv)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format)',
  })
  @ApiOkResponse({ description: 'Analytics data exported successfully' })
  async exportAnalytics(
    @Query() exportDto: ExportAnalyticsDto,
    @Res() res: Response,
  ) {
    const result = await this.adminService.exportAnalyticsData(
      exportDto.type,
      exportDto.format || 'csv',
      exportDto.startDate,
      exportDto.endDate,
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.data);
  }

  // =====================
  // GUEST ANALYTICS
  // =====================

  @Get('dashboard/guest-stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get guest analytics stats' })
  @ApiResponse({
    status: 200,
    description: 'Guest stats retrieved successfully',
  })
  async getGuestStats() {
    const data = await this.adminService.getGuestStats();
    return {
      statusCode: 200,
      message: 'Guest stats retrieved successfully',
      data,
    };
  }
}
