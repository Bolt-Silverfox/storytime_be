import {
  Controller,
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
  CreateAdminDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  BulkActionDto,
} from './dto/user-management.dto';
import { ResetQuotaDto } from './dto/reset-quota.dto';
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
export class AdminUserModerationController {
  constructor(private readonly adminService: AdminService) {}

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
}
