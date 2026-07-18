import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AdminService } from './admin.service';
import { AdminSystemService } from './admin-system.service';
import { Admin } from './decorators/admin.decorator';
import { UserFilterDto } from './dto/admin-filters.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
import {
  ApiBearerAuth,
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
export class AdminUserQueryController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminSystemService: AdminSystemService,
  ) {}

  // =====================
  // USER MANAGEMENT
  // =====================

  @Get('users/export')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Export users as CSV',
    description:
      'Export all users matching the given filters as a CSV file. Supports the same filters as the users list endpoint.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: ['admin', 'parent', 'kid'],
    description: 'Filter by user role',
  })
  @ApiQuery({
    name: 'isEmailVerified',
    required: false,
    type: Boolean,
    description: 'Filter by email verification status',
  })
  @ApiQuery({
    name: 'hasActiveSubscription',
    required: false,
    type: Boolean,
    description: 'Filter by subscription status',
  })
  @ApiOkResponse({ description: 'Users exported as CSV' })
  async exportUsers(
    @Query() filters: UserFilterDto,
    @Res() res: Response,
    @Query('hasActiveSubscription') rawHasActiveSub?: string,
  ) {
    if (rawHasActiveSub !== undefined) {
      filters.hasActiveSubscription = rawHasActiveSub === 'true';
    }
    const csv = await this.adminService.exportUsersAsCsv(filters);

    const filename = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get('users')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all users',
    description:
      'Returns paginated list of users with filters for search, role, subscription status, and date ranges.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john',
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: ['admin', 'parent', 'kid'],
    description: 'Filter by user role',
  })
  @ApiQuery({
    name: 'isEmailVerified',
    required: false,
    type: Boolean,
    description: 'Filter by email verification status',
  })
  @ApiQuery({
    name: 'isDeleted',
    required: false,
    type: Boolean,
    description: 'Filter by deletion status',
  })
  @ApiQuery({
    name: 'hasActiveSubscription',
    required: false,
    type: Boolean,
    description: 'Filter by subscription status',
  })
  @ApiQuery({
    name: 'createdAfter',
    required: false,
    type: String,
    description: 'Filter users created after date (ISO format)',
    example: '2023-10-01',
  })
  @ApiQuery({
    name: 'createdBefore',
    required: false,
    type: String,
    description: 'Filter users created before date (ISO format)',
    example: '2023-10-31',
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
              endsAt: '2023-11-15T10:30:00Z',
            },
            profile: {
              id: 'profile-123',
              language: 'english',
              country: 'US',
            },
            avatar: {
              id: 'avatar-123',
              name: 'Default Avatar',
              url: 'https://example.com/avatar.png',
            },
            kidsCount: 2,
            sessionsCount: 5,
            favoritesCount: 12,
            subscriptionsCount: 1,
            transactionsCount: 3,
          },
        ],
        meta: {
          total: 1250,
          page: 1,
          limit: 10,
          totalPages: 125,
        },
      },
    },
  })
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

    const result = await this.adminService.getAllUsers(filters);
    return {
      statusCode: 200,
      message: 'Users retrieved successfully',
      data: result.data,
      meta: result.meta,
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
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john',
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
              status: 'active',
            },
            createdAt: '2023-10-01T12:00:00Z',
          },
        ],
        meta: {
          total: 180,
          page: 1,
          limit: 10,
          totalPages: 18,
        },
      },
    },
  })
  async getPaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
    );
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: true };
    const result = await this.adminService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Paid users retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/unpaid')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get unpaid users',
    description:
      'Returns paginated list of users without active subscriptions.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for email or name',
    example: 'john',
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
            createdAt: '2023-11-01T10:00:00Z',
          },
        ],
        meta: {
          total: 1070,
          page: 1,
          limit: 10,
          totalPages: 107,
        },
      },
    },
  })
  async getUnpaidUsers(@Query() filters: UserFilterDto) {
    const { page, limit } = PaginationUtil.sanitize(
      filters.page,
      filters.limit,
    );
    filters.page = page;
    filters.limit = limit;

    const modifiedFilters = { ...filters, hasActiveSubscription: false };
    const result = await this.adminService.getAllUsers(modifiedFilters);
    return {
      statusCode: 200,
      message: 'Unpaid users retrieved successfully',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('users/deletion-requests')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List account deletion requests',
    description:
      'Returns parsed list of account deletion requests including reasons and notes.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
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
            isPermanent: false,
          },
        ],
        meta: {
          total: 5,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      },
    },
  })
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user by ID',
    description:
      'Returns detailed user information including profile, kids, subscriptions, payment history, and activity statistics.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
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
          amountSpent: 125.5,
          currency: 'USD',
          profile: {
            id: 'profile-123',
            explicitContent: false,
            maxScreenTimeMins: 120,
            language: 'english',
            country: 'US',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-15T10:30:00Z',
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
                url: 'https://example.com/kid-avatar.png',
              },
            },
          ],
          avatar: {
            id: 'avatar-123',
            name: 'Default Avatar',
            url: 'https://example.com/avatar.png',
            isSystemAvatar: true,
            publicId: 'avatar_123',
            createdAt: '2023-10-01T12:00:00Z',
          },
          subscription: {
            id: 'sub-123',
            plan: 'monthly',
            status: 'active',
            startedAt: '2023-10-01T12:00:00Z',
            endsAt: '2023-11-01T12:00:00Z',
          },
          paymentTransactions: [
            {
              id: 'txn-123',
              amount: 9.99,
              currency: 'USD',
              status: 'success',
              createdAt: '2023-10-01T12:00:00Z',
            },
          ],
          stats: {
            sessionsCount: 5,
            favoritesCount: 12,
            voicesCount: 1,
            subscriptionsCount: 1,
            ticketsCount: 2,
            transactionsCount: 3,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID user-123 not found',
        error: 'Not Found',
      },
    },
  })
  async getUserById(@Param('userId') userId: string) {
    const data = await this.adminService.getUserById(userId);
    return {
      statusCode: 200,
      message: 'User details retrieved successfully',
      data,
    };
  }
}
