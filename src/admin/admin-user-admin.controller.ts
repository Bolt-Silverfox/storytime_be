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
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminService } from './admin.service';
import { AdminSystemService } from './admin-system.service';
import { Admin } from './decorators/admin.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { UserFilterDto } from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  BulkActionDto,
} from './dto/user-management.dto';
import { ResetQuotaDto } from './dto/reset-quota.dto';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { VerifyPurchaseDto } from '../payment/dto/verify-purchase.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
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
export class AdminUserAdminController {
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

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create admin user',
    description:
      'Creates a new admin user with verified email and hashed password.',
  })
  @ApiBody({
    description: 'Admin user creation data',
    schema: {
      example: {
        email: 'admin@example.com',
        password: 'SecurePass123!',
        name: 'Admin User',
        title: 'Mr',
      },
    },
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
          createdAt: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email already exists',
    schema: {
      example: {
        statusCode: 409,
        message: 'User with this email already exists',
        error: 'Conflict',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
    schema: {
      example: {
        statusCode: 400,
        message: ['password must be longer than or equal to 8 characters'],
        error: 'Bad Request',
      },
    },
  })
  async createAdmin(@Body() createAdminDto: CreateAdminDto) {
    const data = await this.adminService.createAdmin(createAdminDto);
    return {
      statusCode: 201,
      message: 'Admin user created successfully',
      data,
    };
  }

  @Put('users/:userId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user',
    description:
      'Updates user information including name, title, role, or email. Enforces unique email validation.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiBody({
    description: 'User update data',
    schema: {
      example: {
        name: 'Updated Name',
        title: 'Dr',
        role: 'admin',
        email: 'updated@example.com',
      },
    },
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
          updatedAt: '2023-10-15T10:30:00Z',
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
  @ApiResponse({
    status: 409,
    description: 'Email already in use',
    schema: {
      example: {
        statusCode: 409,
        message: 'Email already in use',
        error: 'Conflict',
      },
    },
  })
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const data = await this.adminService.updateUser(
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete user',
    description:
      'Soft deletes a user by default. Use permanent=true query parameter for permanent deletion.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete user (default: false - soft delete)',
    example: false,
  })
  @ApiNoContentResponse({
    description: 'User deleted successfully',
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
  async deleteUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('permanent') permanent?: boolean,
  ) {
    await this.adminService.deleteUser(
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restore soft-deleted user',
    description: 'Restores a soft-deleted user account.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
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
          updatedAt: '2023-10-15T10:30:00Z',
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
  async restoreUser(@Param('userId') userId: string) {
    const data = await this.adminService.restoreUser(userId);
    return {
      statusCode: 200,
      message: 'User restored successfully',
      data,
    };
  }

  @Patch('users/:userId/suspend')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Suspend a user',
    description:
      'Suspends a user account, preventing them from accessing the platform. Cannot suspend admin users.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiOkResponse({
    description: 'User suspended successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User suspended successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'parent',
          isSuspended: true,
          suspendedAt: '2023-10-15T10:30:00Z',
          updatedAt: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'User is already suspended or is an admin',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async suspendUser(@Param('userId') userId: string) {
    const data = await this.adminService.suspendUser(userId);
    return {
      statusCode: 200,
      message: 'User suspended successfully',
      data,
    };
  }

  @Patch('users/:userId/unsuspend')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unsuspend a user',
    description:
      'Removes suspension from a user account, restoring their access.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiOkResponse({
    description: 'User unsuspended successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User unsuspended successfully',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'parent',
          isSuspended: false,
          suspendedAt: null,
          updatedAt: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'User is not suspended' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async unsuspendUser(@Param('userId') userId: string) {
    const data = await this.adminService.unsuspendUser(userId);
    return {
      statusCode: 200,
      message: 'User unsuspended successfully',
      data,
    };
  }

  @Post('users/:userId/reset-quota')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reset user usage quotas',
    description:
      'Selectively resets usage quotas for a user based on the flags provided.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiBody({ type: ResetQuotaDto })
  @ApiOkResponse({
    description: 'Quotas reset successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User quotas reset successfully',
        data: {
          id: 'usage-123',
          userId: 'user-123',
          uniqueStoriesRead: 0,
          bonusStories: 0,
          elevenLabsCount: 0,
          geminiStoryCount: 0,
          geminiImageCount: 0,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User usage record not found' })
  async resetUserQuota(
    @Param('userId') userId: string,
    @Body() body: ResetQuotaDto,
  ) {
    const data = await this.adminService.resetUserQuota(userId, body);
    return {
      statusCode: 200,
      message: 'User quotas reset successfully',
      data,
    };
  }

  @Patch('users/:userId/role')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update user role',
    description:
      'Promote or change user role (admin, parent, kid). Prevents self-demotion.',
  })
  @ApiParam({
    name: 'userId',
    type: String,
    description: 'User ID',
    example: 'user-123-uuid',
  })
  @ApiBody({
    description: 'User role update data',
    schema: { example: { role: 'admin' } },
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
          updatedAt: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - self-demotion attempt',
    schema: {
      example: {
        statusCode: 400,
        message: 'You cannot demote yourself from admin status.',
        error: 'Bad Request',
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
  async updateUserRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
  ) {
    const data = await this.adminService.updateUser(
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bulk user actions',
    description:
      'Perform bulk actions (delete, restore, verify) on multiple users.',
  })
  @ApiBody({
    description: 'Bulk action data',
    schema: {
      example: {
        userIds: ['user-123', 'user-456', 'user-789'],
        action: 'verify', // 'delete', 'restore', or 'verify'
      },
    },
  })
  @ApiOkResponse({
    description: 'Bulk action completed successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Bulk action completed successfully',
        data: {
          count: 3,
          action: 'verify',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid action',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid action',
        error: 'Bad Request',
      },
    },
  })
  async bulkUserAction(@Body() bulkActionDto: BulkActionDto) {
    const result = await this.adminService.bulkUserAction(bulkActionDto);
    return {
      statusCode: 200,
      message: 'Bulk action completed successfully',
      data: {
        count: result.count,
        action: bulkActionDto.action,
      },
    };
  }

  // =====================
  // SUBSCRIPTION ACTIVATION
  // =====================

  @Post('users/:userId/activate-subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually activate subscription for a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: ActivateSubscriptionDto })
  @ApiCreatedResponse({ description: 'Subscription activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @HttpCode(HttpStatus.CREATED)
  async activateSubscription(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ActivateSubscriptionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const subscription = await this.adminService.activateSubscription(
      userId,
      dto,
      req.authUserData.userId,
    );
    return {
      statusCode: 201,
      message: 'Subscription activated successfully',
      data: subscription,
    };
  }

  // =====================
  // PURCHASE VERIFICATION
  // =====================

  @Post('users/:userId/verify-purchase')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify a purchase receipt on behalf of a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: VerifyPurchaseDto })
  @ApiOkResponse({ description: 'Purchase verification result' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @HttpCode(HttpStatus.OK)
  async verifyPurchase(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: VerifyPurchaseDto,
  ) {
    const result = await this.adminService.verifyUserPurchase(userId, dto);
    return {
      statusCode: 200,
      message: result.success
        ? 'Purchase verified successfully'
        : 'Purchase verification failed',
      data: result,
    };
  }
}
