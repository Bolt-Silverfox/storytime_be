import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Admin } from './decorators/admin.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import {
  UserFilterDto,
  StoryFilterDto,
  DateRangeDto,
} from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  BulkActionDto,
} from './dto/user-management.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
import { DeletionRequestDto } from './dto/admin-deletion-request.dto';
import {
  DashboardStatsDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  PaginatedResponseDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
} from './dto/admin-responses.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) { }

  // =====================
  // DASHBOARD & ANALYTICS
  // =====================

  @Get('dashboard/stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get dashboard metrics',
    description: 'Returns comprehensive platform KPIs including users, stories, subscriptions, and revenue statistics.',
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
            { plan: 'family', count: 20 }
          ],
          totalRevenue: 12500.50,
          conversionRate: 14.4
        }
      }
    }
  })
  async getDashboardStats(): Promise<DashboardStatsDto> {
    const stats = await this.adminService.getDashboardStats();
    return {
      statusCode: 200,
      message: 'Dashboard metrics retrieved successfully',
      data: stats
    } as any;
  }

  @Get('dashboard/user-growth')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user growth analytics',
    description: 'Returns day-by-day user growth statistics with paid/unpaid breakdown between optional startDate/endDate.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01'
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31'
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
            totalPaidUsers: 150
          },
          {
            date: '2023-10-02',
            newUsers: 8,
            paidUsers: 1,
            totalUsers: 1008,
            totalPaidUsers: 151
          }
        ]
      }
    }
  })
  async getUserGrowth(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getUserGrowth(dateRange);
    return {
      statusCode: 200,
      message: 'User growth analytics retrieved successfully',
      data
    };
  }

  @Get('dashboard/subscription-analytics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get subscription analytics',
    description: 'Returns detailed subscription metrics including growth, revenue, plan breakdown, and churn rate.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01'
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31'
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
            { date: '2023-10-02', count: 3 }
          ],
          revenueGrowth: [
            { date: '2023-10-01', amount: 500 },
            { date: '2023-10-02', amount: 300 }
          ],
          planBreakdown: [
            { plan: 'monthly', count: 120 },
            { plan: 'yearly', count: 60 },
            { plan: 'family', count: 20 }
          ],
          churnRate: 2.5
        }
      }
    }
  })
  async getSubscriptionAnalytics(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getSubscriptionAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Subscription analytics retrieved successfully',
      data
    };
  }

  @Get('dashboard/revenue-analytics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get revenue analytics',
    description: 'Returns detailed revenue breakdown by day, month, year, and top subscription plans.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date for analytics (ISO format, default: 30 days ago)',
    example: '2023-10-01'
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date for analytics (ISO format, default: today)',
    example: '2023-10-31'
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
            { date: '2023-10-02', amount: 750 }
          ],
          monthlyRevenue: [
            { month: '2023-10', total_amount: 12500 },
            { month: '2023-09', total_amount: 11800 }
          ],
          yearlyRevenue: [
            { year: '2023', total_amount: 85000 },
            { year: '2022', total_amount: 72000 }
          ],
          topPlans: [
            {
              plan: 'yearly',
              subscription_count: 60,
              total_revenue: 6000
            },
            {
              plan: 'monthly',
              subscription_count: 120,
              total_revenue: 4800
            }
          ]
        }
      }
    }
  })
  async getRevenueAnalytics(@Query() dateRange: DateRangeDto) {
    const data = await this.adminService.getRevenueAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Revenue analytics retrieved successfully',
      data
    };
  }

  @Get('dashboard/story-stats')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get story statistics',
    description: 'Returns comprehensive story metrics including counts, AI-generated stories, recommendations, and engagement.',
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
          totalFavorites: 2300
        }
      }
    }
  })
  async getStoryStats(): Promise<StoryStatsDto> {
    const stats = await this.adminService.getStoryStats();
    return {
      statusCode: 200,
      message: 'Story statistics retrieved successfully',
      data: stats
    } as any;
  }

  @Get('dashboard/content-breakdown')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get content breakdown',
    description: 'Returns content distribution by language, age group, category, and theme.',
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
            { language: 'French', count: 25 }
          ],
          byAgeGroup: [
            { ageRange: '3-5', count: 100 },
            { ageRange: '6-8', count: 150 },
            { ageRange: '9-12', count: 75 }
          ],
          byCategory: [
            { categoryName: 'Animal Stories', count: 80 },
            { categoryName: 'Adventure & Action', count: 70 },
            { categoryName: 'Bedtime Stories', count: 60 }
          ],
          byTheme: [
            { themeName: 'Adventure', count: 120 },
            { themeName: 'Friendship', count: 90 },
            { themeName: 'Courage', count: 70 }
          ]
        }
      }
    }
  })
  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    const breakdown = await this.adminService.getContentBreakdown();
    return {
      statusCode: 200,
      message: 'Content breakdown retrieved successfully',
      data: breakdown
    } as any;
  }

  @Get('dashboard/system-health')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get system health status',
    description: 'Returns system health metrics including database connectivity, response time, uptime, and memory utilization.',
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
            responseTime: 45
          },
          uptime: 86400,
          memoryUsage: {
            used: 512,
            total: 1024,
            percentage: 50
          },
          timestamp: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  async getSystemHealth(): Promise<SystemHealthDto> {
    const health = await this.adminService.getSystemHealth();
    return {
      statusCode: 200,
      message: 'System health status retrieved successfully',
      data: health
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
    example: 50
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
              role: 'parent'
            },
            kid: {
              id: 'kid-123',
              name: 'Emma Doe'
            }
          }
        ]
      }
    }
  })
  async getRecentActivity(@Query('limit') limit?: number) {
    const { limit: l } = PaginationUtil.sanitize(1, limit, 100);
    const data = await this.adminService.getRecentActivity(l);
    return {
      statusCode: 200,
      message: 'Recent activity logs retrieved successfully',
      data
    };
  }

  @Get('dashboard/ai-credits')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get AI credit analytics',
    description: 'Returns usage stats for AI services (ElevenLabs, Gemini), grouped by month for the current year',
  })
  @ApiOkResponse({
    description: 'AI credit analytics retrieved successfully',
  })
  async getAiCreditStats() {
    const data = await this.adminService.getAiCreditAnalytics();
    return {
      statusCode: 200,
      message: 'AI credit analytics retrieved successfully',
      data
    };
  }

  @Get('dashboard/user-growth-monthly')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get monthly user growth (Free vs Paid)',
    description: 'Returns user growth data for the last 12 months, split by subscription status',
  })
  @ApiOkResponse({
    description: 'User growth data retrieved successfully',
  })
  async getUserGrowthMonthly() {
    const data = await this.adminService.getUserGrowthMonthly();
    return {
      statusCode: 200,
      message: 'User growth data retrieved successfully',
      data: data.data
    };
  }

  // =====================
  // USER MANAGEMENT
  // =====================

  @Get('users')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all users',
    description: 'Returns paginated list of users with filters for search, role, subscription status, and date ranges.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john'
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: ['admin', 'parent', 'kid'],
    description: 'Filter by user role'
  })
  @ApiQuery({
    name: 'isEmailVerified',
    required: false,
    type: Boolean,
    description: 'Filter by email verification status'
  })
  @ApiQuery({
    name: 'isDeleted',
    required: false,
    type: Boolean,
    description: 'Filter by deletion status'
  })
  @ApiQuery({
    name: 'hasActiveSubscription',
    required: false,
    type: Boolean,
    description: 'Filter by subscription status'
  })
  @ApiQuery({
    name: 'createdAfter',
    required: false,
    type: String,
    description: 'Filter users created after date (ISO format)',
    example: '2023-10-01'
  })
  @ApiQuery({
    name: 'createdBefore',
    required: false,
    type: String,
    description: 'Filter users created before date (ISO format)',
    example: '2023-10-31'
  })
  @ApiOkResponse({
    description: 'Users retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Users retrieved successfully',
        data: [
          {
            id: 'user-123',
            email: 'parent@example.com',
            name: 'John Doe',
            title: 'Mr',
            role: 'parent',
            isEmailVerified: true,
            isDeleted: false,
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-15T10:30:00Z',
            isPaidUser: true,
            activeSubscription: {
              id: 'sub-123',
              plan: 'monthly',
              status: 'active',
              endsAt: '2023-11-15T10:30:00Z'
            },
            profile: {
              id: 'profile-123',
              language: 'english',
              country: 'US'
            },
            avatar: {
              id: 'avatar-123',
              name: 'Default Avatar',
              url: 'https://example.com/avatar.png'
            },
            kidsCount: 2,
            sessionsCount: 5,
            favoritesCount: 12,
            subscriptionsCount: 1,
            transactionsCount: 3
          }
        ],
        meta: {
          total: 1250,
          page: 1,
          limit: 10,
          totalPages: 125
        }
      }
    }
  })
  async getAllUsers(@Query() filters: UserFilterDto, @Query('hasActiveSubscription') rawHasActiveSub?: string) {
    // Fix for enableImplicitConversion corrupting 'false' string to boolean true
    if (rawHasActiveSub !== undefined) {
      filters.hasActiveSubscription = rawHasActiveSub === 'true';
    }
    const { page, limit } = PaginationUtil.sanitize(filters.page, filters.limit);
    filters.page = page;
    filters.limit = limit;

    const result = await this.adminService.getAllUsers(filters);
    return {
      statusCode: 200,
      message: 'Users retrieved successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('users/paid')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get paid users',
    description: 'Returns paginated list of users with active subscriptions.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john'
  })
  @ApiOkResponse({
    description: 'Paid users retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Paid users retrieved successfully',
        data: [
          {
            id: 'user-123',
            email: 'parent@example.com',
            name: 'John Doe',
            isPaidUser: true,
            activeSubscription: {
              plan: 'monthly',
              status: 'active'
            },
            createdAt: '2023-10-01T12:00:00Z'
          }
        ],
        meta: {
          total: 180,
          page: 1,
          limit: 10,
          totalPages: 18
        }
      }
    }
  })
  async getPaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(filters.page, filters.limit);
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: true };
    const result = await this.adminService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Paid users retrieved successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('users/unpaid')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get unpaid users',
    description: 'Returns paginated list of users without active subscriptions.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john'
  })
  @ApiOkResponse({
    description: 'Unpaid users retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Unpaid users retrieved successfully',
        data: [
          {
            id: 'user-456',
            email: 'freemium@example.com',
            name: 'Jane Smith',
            isPaidUser: false,
            createdAt: '2023-11-01T10:00:00Z'
          }
        ],
        meta: {
          total: 1070,
          page: 1,
          limit: 10,
          totalPages: 107
        }
      }
    }
  })
  async getUnpaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(filters.page, filters.limit);
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: false };
    const result = await this.adminService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Unpaid users retrieved successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('users/deletion-requests')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List account deletion requests',
    description: 'Returns parsed list of account deletion requests including reasons and notes.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10
  })
  @ApiOkResponse({
    description: 'Deletion requests retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Deletion requests retrieved successfully',
        data: [
          {
            id: 'ticket-1',
            userId: 'user-1',
            userEmail: 'user@example.com',
            userName: 'John Doe',
            reasons: ['Too expensive'],
            notes: 'I prefer another app',
            createdAt: '2023-10-01T12:00:00Z',
            status: 'open',
            isPermanent: false
          }
        ],
        meta: {
          total: 5,
          page: 1,
          limit: 10,
          totalPages: 1
        }
      }
    }
  })
  async getDeletionRequests(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { page: p, limit: l } = PaginationUtil.sanitize(page, limit);
    const result = await this.adminService.getDeletionRequests(p, l);
    return {
      statusCode: 200,
      message: 'Deletion requests retrieved successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('users/:userId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Returns detailed user information including profile, kids, subscriptions, payment history, and activity statistics.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid'
  })
  @ApiOkResponse({
    description: 'User details retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User details retrieved successfully',
        data: {
          id: 'user-123',
          email: 'parent@example.com',
          name: 'John Doe',
          title: 'Mr',
          role: 'parent',
          isEmailVerified: true,
          isDeleted: false,
          createdAt: '2023-10-01T12:00:00Z',
          updatedAt: '2023-10-15T10:30:00Z',
          isPaidUser: true,
          totalSpent: 125.50,
          profile: {
            id: 'profile-123',
            explicitContent: false,
            maxScreenTimeMins: 120,
            language: 'english',
            country: 'US',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-15T10:30:00Z'
          },
          kids: [
            {
              id: 'kid-123',
              name: 'Emma Doe',
              ageRange: '6-8',
              createdAt: '2023-10-05T12:00:00Z',
              avatar: {
                id: 'avatar-456',
                name: 'Kid Avatar',
                url: 'https://example.com/kid-avatar.png'
              }
            }
          ],
          avatar: {
            id: 'avatar-123',
            name: 'Default Avatar',
            url: 'https://example.com/avatar.png',
            isSystemAvatar: true,
            publicId: 'avatar_123',
            createdAt: '2023-10-01T12:00:00Z'
          },
          subscriptions: [
            {
              id: 'sub-123',
              plan: 'monthly',
              status: 'active',
              startedAt: '2023-10-01T12:00:00Z',
              endsAt: '2023-11-01T12:00:00Z'
            }
          ],
          paymentTransactions: [
            {
              id: 'txn-123',
              amount: 9.99,
              currency: 'USD',
              status: 'success',
              createdAt: '2023-10-01T12:00:00Z'
            }
          ],
          stats: {
            sessionsCount: 5,
            favoritesCount: 12,
            voicesCount: 1,
            subscriptionsCount: 1,
            ticketsCount: 2,
            transactionsCount: 3
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found'
      }
    }
  })
  async getUserById(@Param('userId') userId: string) {
    const data = await this.adminService.getUserById(userId);
    return {
      statusCode: 200,
      message: 'User details retrieved successfully',
      data
    };
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create admin user',
    description: 'Creates a new admin user with verified email and hashed password.',
  })
  @ApiBody({
    description: 'Admin user creation data',
    schema: {
      example: {
        email: 'admin@example.com',
        password: 'SecurePass123!',
        name: 'Admin User',
        title: 'Mr'
      }
    }
  })
  @ApiCreatedResponse({
    description: 'Admin user created successfully',
    schema: {
      example: {
        statusCode: 201,
        message: 'Admin user created successfully',
        data: {
          id: 'admin-123',
          email: 'admin@example.com',
          name: 'Admin User',
          role: 'admin',
          createdAt: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 409,
    description: 'Email already exists',
    schema: {
      example: {
        statusCode: 409,
        message: 'User with this email already exists',
        error: 'Conflict'
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
    schema: {
      example: {
        statusCode: 400,
        message: ['password must be longer than or equal to 8 characters'],
        error: 'Bad Request'
      }
    }
  })
  async createAdmin(@Body() createAdminDto: CreateAdminDto) {
    const data = await this.adminService.createAdmin(createAdminDto);
    return {
      statusCode: 201,
      message: 'Admin user created successfully',
      data
    };
  }

  @Put('users/:userId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user',
    description: 'Updates user information including name, title, role, or email. Enforces unique email validation.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid'
  })
  @ApiBody({
    description: 'User update data',
    schema: {
      example: {
        name: 'Updated Name',
        title: 'Dr',
        role: 'admin',
        email: 'updated@example.com'
      }
    }
  })
  @ApiOkResponse({
    description: 'User updated successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User updated successfully',
        data: {
          id: 'user-123',
          email: 'updated@example.com',
          name: 'Updated Name',
          title: 'Dr',
          role: 'admin',
          isEmailVerified: true,
          updatedAt: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found'
      }
    }
  })
  @ApiResponse({
    status: 409,
    description: 'Email already in use',
    schema: {
      example: {
        statusCode: 409,
        message: 'Email already in use',
        error: 'Conflict'
      }
    }
  })
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const data = await this.adminService.updateUser(userId, updateUserDto, req.authUserData.userId);
    return {
      statusCode: 200,
      message: 'User updated successfully',
      data
    };
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete user',
    description: 'Soft deletes a user by default. Use permanent=true query parameter for permanent deletion.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid'
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete user (default: false - soft delete)',
    example: false
  })
  @ApiNoContentResponse({
    description: 'User deleted successfully'
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found'
      }
    }
  })
  async deleteUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('permanent') permanent?: boolean,
  ) {
    await this.adminService.deleteUser(userId, permanent, req.authUserData.userId);
    return {
      statusCode: 204,
      message: permanent ? 'User permanently deleted' : 'User soft deleted'
    };
  }

  @Patch('users/:userId/restore')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restore soft-deleted user',
    description: 'Restores a soft-deleted user account.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid'
  })
  @ApiOkResponse({
    description: 'User restored successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User restored successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          isDeleted: false,
          deletedAt: null,
          updatedAt: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found'
      }
    }
  })
  async restoreUser(@Param('userId') userId: string) {
    const data = await this.adminService.restoreUser(userId);
    return {
      statusCode: 200,
      message: 'User restored successfully',
      data
    };
  }

  @Patch('users/:userId/role')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user role',
    description: 'Promote or change user role (admin, parent, kid). Prevents self-demotion.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid'
  })
  @ApiBody({
    description: 'User role update data',
    schema: { example: { role: 'admin' } }
  })
  @ApiOkResponse({
    description: 'User role updated successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User role updated successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'admin',
          isEmailVerified: true,
          updatedAt: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - self-demotion attempt',
    schema: {
      example: {
        statusCode: 400,
        message: 'You cannot demote yourself from admin status.',
        error: 'Bad Request'
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found'
      }
    }
  })
  async updateUserRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
  ) {
    const data = await this.adminService.updateUser(
      userId,
      { role: updateUserRoleDto.role },
      req.authUserData.userId
    );
    return {
      statusCode: 200,
      message: 'User role updated successfully',
      data
    };
  }

  @Post('users/bulk-action')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bulk user actions',
    description: 'Perform bulk actions (delete, restore, verify) on multiple users.',
  })
  @ApiBody({
    description: 'Bulk action data',
    schema: {
      example: {
        userIds: ['user-123', 'user-456', 'user-789'],
        action: 'verify' // 'delete', 'restore', or 'verify'
      }
    }
  })
  @ApiOkResponse({
    description: 'Bulk action completed successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Bulk action completed successfully',
        data: {
          count: 3,
          action: 'verify'
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid action',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid action',
        error: 'Bad Request'
      }
    }
  })
  async bulkUserAction(@Body() bulkActionDto: BulkActionDto) {
    const result = await this.adminService.bulkUserAction(bulkActionDto);
    return {
      statusCode: 200,
      message: 'Bulk action completed successfully',
      data: {
        count: result.count,
        action: bulkActionDto.action
      }
    };
  }

  // =====================
  // STORY MANAGEMENT
  // =====================

  @Get('stories')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all stories',
    description: 'Returns paginated list of stories with filters for search, recommendations, AI generation, language, and age range.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for title or description',
    example: 'magic'
  })
  @ApiQuery({
    name: 'recommended',
    required: false,
    type: Boolean,
    description: 'Filter by recommended status'
  })
  @ApiQuery({
    name: 'aiGenerated',
    required: false,
    type: Boolean,
    description: 'Filter by AI-generated status'
  })
  @ApiQuery({
    name: 'isDeleted',
    required: false,
    type: Boolean,
    description: 'Filter by deletion status'
  })
  @ApiQuery({
    name: 'language',
    required: false,
    type: String,
    description: 'Filter by language',
    example: 'english'
  })
  @ApiQuery({
    name: 'minAge',
    required: false,
    type: Number,
    description: 'Minimum age filter',
    example: 3
  })
  @ApiQuery({
    name: 'maxAge',
    required: false,
    type: Number,
    description: 'Maximum age filter',
    example: 12
  })
  @ApiOkResponse({
    description: 'Stories retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Stories retrieved successfully',
        data: [
          {
            id: 'story-123',
            title: 'The Magic Forest',
            description: 'A magical adventure in an enchanted forest',
            language: 'english',
            coverImageUrl: 'https://example.com/forest.jpg',
            ageMin: 3,
            ageMax: 8,
            recommended: true,
            aiGenerated: false,
            isDeleted: false,
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-15T10:30:00Z',
            categories: [
              { id: 'cat-1', name: 'Fantasy & Magic' }
            ],
            themes: [
              { id: 'theme-1', name: 'Adventure' }
            ],
            favoritesCount: 45,
            viewsCount: 120,
            parentFavoritesCount: 15,
            downloadsCount: 30
          }
        ],
        meta: {
          total: 325,
          page: 1,
          limit: 10,
          totalPages: 33
        }
      }
    }
  })
  async getAllStories(@Query() filters: StoryFilterDto) {
    const result = await this.adminService.getAllStories(filters);
    return {
      statusCode: 200,
      message: 'Stories retrieved successfully',
      data: result.data,
      meta: result.meta
    };
  }

  @Get('stories/:storyId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get story by ID',
    description: 'Returns detailed story information including images, categories, themes, branches, questions, and engagement metrics.',
  })
  @ApiParam({
    name: 'storyId',
    type: String,
    description: 'Story ID',
    example: 'story-123-uuid'
  })
  @ApiOkResponse({
    description: 'Story details retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story details retrieved successfully',
        data: {
          id: 'story-123',
          title: 'The Magic Forest',
          description: 'A magical adventure in an enchanted forest',
          language: 'english',
          coverImageUrl: 'https://example.com/forest.jpg',
          audioUrl: 'https://example.com/forest.mp3',
          textContent: 'Once upon a time in a magical forest...',
          isInteractive: true,
          ageMin: 3,
          ageMax: 8,
          backgroundColor: '#5E3A54',
          recommended: true,
          aiGenerated: false,
          difficultyLevel: 1,
          wordCount: 500,
          isDeleted: false,
          createdAt: '2023-10-01T12:00:00Z',
          updatedAt: '2023-10-15T10:30:00Z',
          images: [
            {
              id: 'img-123',
              url: 'https://example.com/forest-1.jpg',
              caption: 'The enchanted forest entrance'
            }
          ],
          categories: [
            { id: 'cat-1', name: 'Fantasy & Magic' }
          ],
          themes: [
            { id: 'theme-1', name: 'Adventure' }
          ],
          branches: [
            {
              id: 'branch-1',
              prompt: 'Which path will you take?',
              optionA: 'Take the left path',
              optionB: 'Take the right path',
              nextA: 'story-124',
              nextB: 'story-125'
            }
          ],
          questions: [
            {
              id: 'question-1',
              question: 'What was the main character\'s name?',
              options: ['Alice', 'Bob', 'Charlie', 'Diana'],
              correctOption: 0
            }
          ],
          stats: {
            favoritesCount: 45,
            viewsCount: 120,
            parentFavoritesCount: 15,
            downloadsCount: 30
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Story not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Story with ID story-123 not found',
        error: 'Not Found'
      }
    }
  })
  async getStoryById(@Param('storyId') storyId: string) {
    const data = await this.adminService.getStoryById(storyId);
    return {
      statusCode: 200,
      message: 'Story details retrieved successfully',
      data
    };
  }

  @Patch('stories/:storyId/recommend')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Toggle story recommendation',
    description: 'Toggles the recommended flag for a story.',
  })
  @ApiParam({
    name: 'storyId',
    type: String,
    description: 'Story ID',
    example: 'story-123-uuid'
  })
  @ApiOkResponse({
    description: 'Story recommendation toggled successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Story recommendation toggled successfully',
        data: {
          id: 'story-123',
          title: 'The Magic Forest',
          recommended: true,
          updatedAt: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Story not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Story with ID story-123 not found',
        error: 'Not Found'
      }
    }
  })
  async toggleStoryRecommendation(@Param('storyId') storyId: string) {
    const data = await this.adminService.toggleStoryRecommendation(storyId);
    return {
      statusCode: 200,
      message: 'Story recommendation toggled successfully',
      data
    };
  }

  @Delete('stories/:storyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete story',
    description: 'Soft deletes a story by default. Use permanent=true query parameter for permanent deletion.',
  })
  @ApiParam({
    name: 'storyId',
    type: String,
    description: 'Story ID',
    example: 'story-123-uuid'
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete story (default: false - soft delete)',
    example: false
  })
  @ApiNoContentResponse({
    description: 'Story deleted successfully'
  })
  @ApiResponse({
    status: 404,
    description: 'Story not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Story with ID story-123 not found',
        error: 'Not Found'
      }
    }
  })
  async deleteStory(
    @Param('storyId') storyId: string,
    @Query('permanent') permanent?: boolean,
  ) {
    await this.adminService.deleteStory(storyId, permanent);
    return {
      statusCode: 204,
      message: permanent ? 'Story permanently deleted' : 'Story soft deleted'
    };
  }

  // =====================
  // CATEGORY & THEME MANAGEMENT
  // =====================

  @Get('categories')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all categories',
    description: 'Returns all categories with story counts and kid preference statistics.',
  })
  @ApiOkResponse({
    description: 'Categories retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Categories retrieved successfully',
        data: [
          {
            id: 'cat-1',
            name: 'Animal Stories',
            image: 'https://example.com/animals.jpg',
            description: 'Stories featuring animals as main characters',
            isDeleted: false,
            deletedAt: null,
            _count: {
              stories: 80,
              preferredByKids: 45
            }
          },
          {
            id: 'cat-2',
            name: 'Adventure & Action',
            image: 'https://example.com/adventure.jpg',
            description: 'Exciting stories full of adventure and action',
            isDeleted: false,
            deletedAt: null,
            _count: {
              stories: 70,
              preferredByKids: 35
            }
          }
        ]
      }
    }
  })
  async getCategories() {
    const data = await this.adminService.getCategories();
    return {
      statusCode: 200,
      message: 'Categories retrieved successfully',
      data
    };
  }

  @Get('themes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all themes',
    description: 'Returns all themes with story counts.',
  })
  @ApiOkResponse({
    description: 'Themes retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Themes retrieved successfully',
        data: [
          {
            id: 'theme-1',
            name: 'Adventure',
            image: 'https://example.com/adventure.jpg',
            description: 'Themes of adventure and exploration',
            isDeleted: false,
            deletedAt: null,
            _count: {
              stories: 120
            }
          },
          {
            id: 'theme-2',
            name: 'Friendship & Belonging',
            image: 'https://example.com/friendship.jpg',
            description: 'Themes of friendship and belonging',
            isDeleted: false,
            deletedAt: null,
            _count: {
              stories: 90
            }
          }
        ]
      }
    }
  })
  async getThemes() {
    const data = await this.adminService.getThemes();
    return {
      statusCode: 200,
      message: 'Themes retrieved successfully',
      data
    };
  }

  // =====================
  // SUBSCRIPTION MANAGEMENT
  // =====================

  @Get('subscriptions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all subscriptions',
    description: 'Returns all subscriptions with user details. Optional status filter.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by subscription status',
    example: 'active'
  })
  @ApiOkResponse({
    description: 'Subscriptions retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Subscriptions retrieved successfully',
        data: [
          {
            id: 'sub-123',
            plan: 'monthly',
            status: 'active',
            startedAt: '2023-10-01T12:00:00Z',
            endsAt: '2023-11-01T12:00:00Z',
            isDeleted: false,
            deletedAt: null,
            user: {
              id: 'user-123',
              email: 'parent@example.com',
              name: 'John Doe'
            }
          },
          {
            id: 'sub-124',
            plan: 'yearly',
            status: 'cancelled',
            startedAt: '2023-09-01T12:00:00Z',
            endsAt: '2024-09-01T12:00:00Z',
            isDeleted: false,
            deletedAt: null,
            user: {
              id: 'user-124',
              email: 'parent2@example.com',
              name: 'Jane Smith'
            }
          }
        ]
      }
    }
  })
  async getSubscriptions(@Query('status') status?: string) {
    const data = await this.adminService.getSubscriptions(status);
    return {
      statusCode: 200,
      message: 'Subscriptions retrieved successfully',
      data
    };
  }

  // =====================
  // SYSTEM CONFIGURATION
  // =====================

  @Post('seed')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Seed database',
    description: 'Seeds the database with initial categories, themes, avatars, and age groups.',
  })
  @ApiOkResponse({
    description: 'Database seeded successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Database seeded successfully',
        data: {
          message: 'Database seeded successfully'
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Failed to seed database',
    schema: {
      example: {
        statusCode: 400,
        message: 'Failed to seed database',
        error: 'Bad Request'
      }
    }
  })
  async seedDatabase() {
    const data = await this.adminService.seedDatabase();
    return {
      statusCode: 200,
      message: 'Database seeded successfully',
      data
    };
  }

  @Get('backup')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create database backup',
    description: 'Generates a database backup file.',
  })
  @ApiOkResponse({
    description: 'Backup created successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Backup created successfully',
        data: {
          message: 'Backup created successfully',
          timestamp: '2023-10-15T10:30:00Z'
        }
      }
    }
  })
  async createBackup() {
    const data = await this.adminService.createBackup();
    return {
      statusCode: 200,
      message: 'Backup created successfully',
      data
    };
  }

  @Get('logs')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get system logs',
    description: 'Returns system activity logs with optional filtering by log level.',
  })
  @ApiQuery({
    name: 'level',
    required: false,
    type: String,
    description: 'Filter by log level',
    example: 'SUCCESS'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of logs to return (default: 100, max: 500)',
    example: 100
  })
  @ApiOkResponse({
    description: 'System logs retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'System logs retrieved successfully',
        data: [
          {
            id: 'log-123',
            userId: 'user-123',
            kidId: 'kid-123',
            action: 'USER_LOGIN',
            status: 'SUCCESS',
            deviceName: 'iPhone 13',
            deviceModel: 'A2482',
            os: 'iOS 17',
            ipAddress: '192.168.1.100',
            details: 'User logged in successfully',
            createdAt: '2023-10-15T10:30:00Z',
            user: {
              id: 'user-123',
              email: 'parent@example.com',
              name: 'John Doe'
            }
          }
        ]
      }
    }
  })
  async getSystemLogs(
    @Query('level') level?: string,
    @Query('limit') limit?: number,
  ) {
    const { limit: l } = PaginationUtil.sanitize(1, limit, 500);
    const data = await this.adminService.getSystemLogs(level, l);
    return {
      statusCode: 200,
      message: 'System logs retrieved successfully',
      data
    };
  }



  // =====================
  // INTEGRATIONS
  // =====================

  @Get('integrations/elevenlabs/balance')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ElevenLabs credit balance' })
  async getElevenLabsBalance() {
    const data = await this.adminService.getElevenLabsBalance();
    return {
      statusCode: 200,
      message: 'ElevenLabs balance retrieved',
      data
    };
  }

  // =====================
  // SUPPORT TICKETS
  // =====================

  @Get('support/tickets')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all support tickets' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getAllSupportTickets(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    const { page: p, limit: l } = PaginationUtil.sanitize(page, limit);
    const result = await this.adminService.getAllSupportTickets(p, l, status);
    return {
      statusCode: 200,
      message: 'Support tickets retrieved',
      data: result.data,
      meta: result.meta
    };
  }

  @Patch('support/tickets/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update support ticket status' })
  @ApiBody({ schema: { type: 'object', properties: { status: { type: 'string', example: 'resolved' } } } })
  async updateSupportTicket(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const result = await this.adminService.updateSupportTicket(id, status);
    return {
      statusCode: 200,
      message: 'Support ticket updated',
      data: result
    };
  }
}