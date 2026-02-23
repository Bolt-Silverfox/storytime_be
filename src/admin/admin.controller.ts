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
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminUserService } from './admin-user.service';
import { AdminStoryService } from './admin-story.service';
import { AdminSystemService } from './admin-system.service';
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
import { ExportAnalyticsDto } from './dto/admin-export.dto';
import type {
  AiCreditDuration,
  UserGrowthDuration,
} from './admin-analytics.service';
import { PaginationUtil } from '../shared/utils/pagination.util';
import {
  DashboardStatsDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  ApiResponseDto,
} from './dto/admin-responses.dto';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import * as Swagger from './decorators/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminController {
  constructor(
    private readonly adminAnalyticsService: AdminAnalyticsService,
    private readonly adminUserService: AdminUserService,
    private readonly adminStoryService: AdminStoryService,
    private readonly adminSystemService: AdminSystemService,
  ) {}

  // =====================
  // DASHBOARD & ANALYTICS
  // =====================

  @Get('dashboard/stats')
  @Swagger.ApiAdminGetDashboardStats()
  async getDashboardStats(): Promise<ApiResponseDto<DashboardStatsDto>> {
    const stats = await this.adminAnalyticsService.getDashboardStats();
    return {
      statusCode: 200,
      message: 'Dashboard metrics retrieved successfully',
      data: stats,
    };
  }

  @Get('dashboard/user-growth')
  @Swagger.ApiAdminGetUserGrowth()
  async getUserGrowth(@Query() dateRange: DateRangeDto) {
    const data = await this.adminAnalyticsService.getUserGrowth(dateRange);
    return {
      statusCode: 200,
      message: 'User growth analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/subscription-analytics')
  @Swagger.ApiAdminGetSubscriptionAnalytics()
  async getSubscriptionAnalytics(@Query() dateRange: DateRangeDto) {
    const data =
      await this.adminAnalyticsService.getSubscriptionAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Subscription analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/revenue-analytics')
  @Swagger.ApiAdminGetRevenueAnalytics()
  async getRevenueAnalytics(@Query() dateRange: DateRangeDto) {
    const data =
      await this.adminAnalyticsService.getRevenueAnalytics(dateRange);
    return {
      statusCode: 200,
      message: 'Revenue analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/story-stats')
  @Swagger.ApiAdminGetStoryStats()
  async getStoryStats(): Promise<ApiResponseDto<StoryStatsDto>> {
    const stats = await this.adminAnalyticsService.getStoryStats();
    return {
      statusCode: 200,
      message: 'Story statistics retrieved successfully',
      data: stats,
    };
  }

  @Get('dashboard/content-breakdown')
  @Swagger.ApiAdminGetContentBreakdown()
  async getContentBreakdown(): Promise<ApiResponseDto<ContentBreakdownDto>> {
    const breakdown = await this.adminAnalyticsService.getContentBreakdown();
    return {
      statusCode: 200,
      message: 'Content breakdown retrieved successfully',
      data: breakdown,
    };
  }

  @Get('dashboard/system-health')
  @Swagger.ApiAdminGetSystemHealth()
  async getSystemHealth(): Promise<ApiResponseDto<SystemHealthDto>> {
    const health = await this.adminAnalyticsService.getSystemHealth();
    return {
      statusCode: 200,
      message: 'System health status retrieved successfully',
      data: health,
    };
  }

  @Get('dashboard/recent-activity')
  @Swagger.ApiAdminGetRecentActivity()
  async getRecentActivity(@Query('limit') limit?: number) {
    const { limit: l } = PaginationUtil.sanitize(1, limit, 100);
    const data = await this.adminSystemService.getRecentActivity(l);
    return {
      statusCode: 200,
      message: 'Recent activity logs retrieved successfully',
      data,
    };
  }

  @Get('dashboard/ai-credits')
  @Swagger.ApiAdminGetAiCreditStats()
  @ApiQuery({
    name: 'duration',
    required: false,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    description: 'Time duration filter for AI credit analytics',
  })
  async getAiCreditStats(
    @Query('duration') duration?: AiCreditDuration,
  ) {
    const data = await this.adminAnalyticsService.getAiCreditAnalytics(duration);
    return {
      statusCode: 200,
      message: 'AI credit analytics retrieved successfully',
      data,
    };
  }

  @Get('dashboard/user-growth-monthly')
  @Swagger.ApiAdminGetUserGrowthMonthly()
  @ApiQuery({
    name: 'duration',
    required: false,
    enum: ['last_year', 'last_month', 'last_week'],
    description: 'Time duration filter for user growth data',
  })
  async getUserGrowthMonthly(
    @Query('duration') duration?: UserGrowthDuration,
  ) {
    const data = await this.adminAnalyticsService.getUserGrowthMonthly(duration);
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
  @ApiOperation({ summary: 'Export analytics data' })
  async exportAnalytics(@Query() dto: ExportAnalyticsDto) {
    return this.adminAnalyticsService.exportAnalyticsData(
      dto.type,
      dto.format ?? 'csv',
      dto.startDate,
      dto.endDate,
    );
  }

  @Get('users/export')
  @ApiOperation({ summary: 'Export users as CSV' })
  async exportUsers() {
    const csv = await this.adminUserService.exportUsersAsCsv();
    return { data: csv, contentType: 'text/csv' };
  }

  // =====================
  // USER MANAGEMENT
  // =====================

  @Get('users')
  @Swagger.ApiAdminGetAllUsers()
  async getAllUsers(
    @Query() filters: UserFilterDto,
    @Query('hasActiveSubscription') rawHasActiveSub?: string,
  ) {
    // Fix for enableImplicitConversion corrupting 'false' string to boolean true
    if (rawHasActiveSub !== undefined) {
      filters.hasActiveSubscription = rawHasActiveSub === 'true';
    }
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
    );
    filters.page = page;
    filters.limit = limit;

    const result = await this.adminUserService.getAllUsers(filters);
    return {
      statusCode: 200,
      message: 'Users retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/paid')
  @Swagger.ApiAdminGetPaidUsers()
  async getPaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
    );
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: true };
    const result = await this.adminUserService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Paid users retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/unpaid')
  @Swagger.ApiAdminGetUnpaidUsers()
  async getUnpaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
    );
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: false };
    const result = await this.adminUserService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Unpaid users retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/deletion-requests')
  @Swagger.ApiAdminGetDeletionRequests()
  async getDeletionRequests(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const { page: p, limit: l } = PaginationUtil.sanitize(page, limit);
    const result = await this.adminSystemService.getDeletionRequests(p, l);
    return {
      statusCode: 200,
      message: 'Deletion requests retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/:userId')
  @Swagger.ApiAdminGetUserById()
  async getUserById(@Param('userId') userId: string) {
    const data = await this.adminUserService.getUserById(userId);
    return {
      statusCode: 200,
      message: 'User details retrieved successfully',
      data,
    };
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @Swagger.ApiAdminCreateUser()
  async createAdmin(@Body() createAdminDto: CreateAdminDto) {
    const data = await this.adminUserService.createAdmin(createAdminDto);
    return {
      statusCode: 201,
      message: 'Admin user created successfully',
      data,
    };
  }

  @Put('users/:userId')
  @Swagger.ApiAdminUpdateUser()
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const data = await this.adminUserService.updateUser(
      userId,
      updateUserDto,
      req.authUserData.userId,
    );
    return {
      statusCode: 200,
      message: 'User updated successfully',
      data,
    };
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Swagger.ApiAdminDeleteUser()
  async deleteUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('permanent') permanent?: boolean,
  ) {
    await this.adminUserService.deleteUser(
      userId,
      permanent,
      req.authUserData.userId,
    );
    return {
      statusCode: 204,
      message: permanent ? 'User permanently deleted' : 'User soft deleted',
    };
  }

  @Patch('users/:userId/restore')
  @Swagger.ApiAdminRestoreUser()
  async restoreUser(@Param('userId') userId: string) {
    const data = await this.adminUserService.restoreUser(userId);
    return {
      statusCode: 200,
      message: 'User restored successfully',
      data,
    };
  }

  @Patch('users/:userId/role')
  @Swagger.ApiAdminUpdateUserRole()
  async updateUserRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
  ) {
    const data = await this.adminUserService.updateUser(
      userId,
      { role: updateUserRoleDto.role },
      req.authUserData.userId,
    );
    return {
      statusCode: 200,
      message: 'User role updated successfully',
      data,
    };
  }

  @Post('users/bulk-action')
  @HttpCode(HttpStatus.OK)
  @Swagger.ApiAdminBulkUserAction()
  async bulkUserAction(@Body() bulkActionDto: BulkActionDto) {
    const result = await this.adminUserService.bulkUserAction(bulkActionDto);
    return {
      statusCode: 200,
      message: 'Bulk action completed successfully',
      data: {
        count: result.count,
        action: bulkActionDto.action,
      },
    };
  }

  @Patch('users/:userId/suspend')
  @Swagger.ApiAdminSuspendUser()
  async suspendUser(@Param('userId') userId: string) {
    const data = await this.adminUserService.suspendUser(userId);
    return {
      statusCode: 200,
      message: 'User suspended successfully',
      data,
    };
  }

  @Patch('users/:userId/unsuspend')
  @Swagger.ApiAdminUnsuspendUser()
  async unsuspendUser(@Param('userId') userId: string) {
    const data = await this.adminUserService.unsuspendUser(userId);
    return {
      statusCode: 200,
      message: 'User unsuspended successfully',
      data,
    };
  }

  // =====================
  // STORY MANAGEMENT
  // =====================

  @Get('stories')
  @Swagger.ApiAdminGetAllStories()
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: String,
    description: 'Filter stories by category ID',
  })
  async getAllStories(@Query() filters: StoryFilterDto) {
    const result = await this.adminStoryService.getAllStories(filters);
    return {
      statusCode: 200,
      message: 'Stories retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('stories/:storyId')
  @Swagger.ApiAdminGetStoryById()
  async getStoryById(@Param('storyId') storyId: string) {
    const data = await this.adminStoryService.getStoryById(storyId);
    return {
      statusCode: 200,
      message: 'Story details retrieved successfully',
      data,
    };
  }

  @Patch('stories/:storyId/recommend')
  @Swagger.ApiAdminToggleStoryRecommendation()
  async toggleStoryRecommendation(@Param('storyId') storyId: string) {
    const data =
      await this.adminStoryService.toggleStoryRecommendation(storyId);
    return {
      statusCode: 200,
      message: 'Story recommendation toggled successfully',
      data,
    };
  }

  @Delete('stories/:storyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Swagger.ApiAdminDeleteStory()
  async deleteStory(
    @Param('storyId') storyId: string,
    @Query('permanent') permanent?: boolean,
  ) {
    await this.adminStoryService.deleteStory(storyId, permanent);
    return {
      statusCode: 204,
      message: permanent ? 'Story permanently deleted' : 'Story soft deleted',
    };
  }

  // =====================
  // CATEGORY & THEME MANAGEMENT
  // =====================

  @Get('categories')
  @Swagger.ApiAdminGetCategories()
  async getCategories() {
    const data = await this.adminStoryService.getCategories();
    return {
      statusCode: 200,
      message: 'Categories retrieved successfully',
      data,
    };
  }

  @Get('themes')
  @Swagger.ApiAdminGetThemes()
  async getThemes() {
    const data = await this.adminStoryService.getThemes();
    return {
      statusCode: 200,
      message: 'Themes retrieved successfully',
      data,
    };
  }

  // =====================
  // SUBSCRIPTION MANAGEMENT
  // =====================

  @Get('subscriptions')
  @Swagger.ApiAdminGetSubscriptions()
  async getSubscriptions(@Query('status') status?: string) {
    const data = await this.adminSystemService.getSubscriptions(status);
    return {
      statusCode: 200,
      message: 'Subscriptions retrieved successfully',
      data,
    };
  }

  // =====================
  // SYSTEM CONFIGURATION
  // =====================

  @Post('seed')
  @Swagger.ApiAdminSeedDatabase()
  async seedDatabase() {
    const data = await this.adminSystemService.seedDatabase();
    return {
      statusCode: 200,
      message: 'Database seeded successfully',
      data,
    };
  }

  @Get('backup')
  @Swagger.ApiAdminCreateBackup()
  createBackup() {
    const data = this.adminSystemService.createBackup();
    return {
      statusCode: 200,
      message: 'Backup created successfully',
      data,
    };
  }

  @Get('logs')
  @Swagger.ApiAdminGetSystemLogs()
  async getSystemLogs(
    @Query('level') level?: string,
    @Query('limit') limit?: number,
  ) {
    const { limit: l } = PaginationUtil.sanitize(1, limit, 500);
    const data = await this.adminSystemService.getSystemLogs(level, l);
    return {
      statusCode: 200,
      message: 'System logs retrieved successfully',
      data,
    };
  }

  // =====================
  // INTEGRATIONS
  // =====================

  @Get('integrations/elevenlabs/balance')
  @Swagger.ApiAdminGetElevenLabsBalance()
  async getElevenLabsBalance() {
    const data = await this.adminSystemService.getElevenLabsBalance();
    return {
      statusCode: 200,
      message: 'ElevenLabs balance retrieved',
      data,
    };
  }

  // =====================
  // SUPPORT TICKETS
  // =====================

  @Get('support/tickets')
  @Swagger.ApiAdminGetAllSupportTickets()
  async getAllSupportTickets(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    const { page: p, limit: l } = PaginationUtil.sanitize(page, limit);
    const result = await this.adminSystemService.getAllSupportTickets(
      p,
      l,
      status,
    );
    return {
      statusCode: 200,
      message: 'Support tickets retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  @Patch('support/tickets/:id')
  @Swagger.ApiAdminUpdateSupportTicket()
  async updateSupportTicket(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const result = await this.adminSystemService.updateSupportTicket(
      id,
      status,
    );
    return {
      statusCode: 200,
      message: 'Support ticket updated',
      data: result,
    };
  }
}
