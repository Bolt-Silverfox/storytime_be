import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiCreatedResponse,
  ApiResponse,
} from '@nestjs/swagger';

export function ApiAdminGetAllUsers() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List all users',
      description:
        'Returns paginated list of users with filters for search, role, subscription status, and date ranges.',
    }),
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number (default: 1)',
      example: 1,
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Items per page (default: 10, max: 100)',
      example: 10,
    }),
    ApiQuery({
      name: 'search',
      required: false,
      type: String,
      description: 'Search term for email or name',
      example: 'john',
    }),
    ApiQuery({
      name: 'role',
      required: false,
      enum: ['admin', 'parent', 'kid'],
      description: 'Filter by user role',
    }),
    ApiQuery({
      name: 'isEmailVerified',
      required: false,
      type: Boolean,
      description: 'Filter by email verification status',
    }),
    ApiQuery({
      name: 'isDeleted',
      required: false,
      type: Boolean,
      description: 'Filter by deletion status',
    }),
    ApiQuery({
      name: 'hasActiveSubscription',
      required: false,
      type: Boolean,
      description: 'Filter by subscription status',
    }),
    ApiQuery({
      name: 'createdAfter',
      required: false,
      type: String,
      description: 'Filter users created after date (ISO format)',
      example: '2023-10-01',
    }),
    ApiQuery({
      name: 'createdBefore',
      required: false,
      type: String,
      description: 'Filter users created before date (ISO format)',
      example: '2023-10-31',
    }),
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetPaidUsers() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get paid users',
      description: 'Returns paginated list of users with active subscriptions.',
    }),
    ApiQuery({ name: 'page', required: false, type: Number }),
    ApiQuery({ name: 'limit', required: false, type: Number }),
    ApiQuery({ name: 'search', required: false, type: String }),
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetUnpaidUsers() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get unpaid users',
      description:
        'Returns paginated list of users without active subscriptions.',
    }),
    ApiQuery({ name: 'page', required: false, type: Number }),
    ApiQuery({ name: 'limit', required: false, type: Number }),
    ApiQuery({ name: 'search', required: false, type: String }),
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetUserById() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get user by ID',
      description:
        'Returns detailed user information including profile, kids, subscriptions, payment history, and activity statistics.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiOkResponse({
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
            totalSpent: 125.5,
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
            subscriptions: [
              {
                id: 'sub-123',
                plan: 'monthly',
                status: 'active',
                startedAt: '2023-10-01T12:00:00Z',
                endsAt: '2023-11-01T12:00:00Z',
              },
            ],
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
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminCreateUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Create admin user',
      description:
        'Creates a new admin user with verified email and hashed password.',
    }),
    ApiBody({
      description: 'Admin user creation data',
      schema: {
        example: {
          email: 'admin@example.com',
          password: 'SecurePass123!',
          name: 'Admin User',
          title: 'Mr',
        },
      },
    }),
    ApiCreatedResponse({
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
    }),
    ApiResponse({
      status: 409,
      description: 'Email already exists',
      schema: {
        example: {
          statusCode: 409,
          message: 'User with this email already exists',
          error: 'Conflict',
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid input data',
      schema: {
        example: {
          statusCode: 400,
          message: ['password must be longer than or equal to 8 characters'],
          error: 'Bad Request',
        },
      },
    }),
  );
}

export function ApiAdminUpdateUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Update user',
      description:
        'Updates user information including name, title, role, or email. Enforces unique email validation.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiBody({
      description: 'User update data',
      schema: {
        example: {
          name: 'Updated Name',
          title: 'Dr',
          role: 'admin',
          email: 'updated@example.com',
        },
      },
    }),
    ApiOkResponse({
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
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
    ApiResponse({
      status: 409,
      description: 'Email already in use',
      schema: {
        example: {
          statusCode: 409,
          message: 'Email already in use',
          error: 'Conflict',
        },
      },
    }),
  );
}

export function ApiAdminDeleteUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Delete user',
      description:
        'Soft deletes a user by default. Use permanent=true query parameter for permanent deletion.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiQuery({
      name: 'permanent',
      required: false,
      type: Boolean,
      description: 'Permanently delete user (default: false - soft delete)',
      example: false,
    }),
    ApiResponse({ status: 204, description: 'User deleted successfully' }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminRestoreUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Restore soft-deleted user',
      description: 'Restores a soft-deleted user account.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiOkResponse({
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
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminUpdateUserRole() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Update user role',
      description:
        'Promote or change user role (admin, parent, kid). Prevents self-demotion.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiBody({
      description: 'User role update data',
      schema: { example: { role: 'admin' } },
    }),
    ApiOkResponse({
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
    }),
    ApiResponse({
      status: 400,
      description: 'Bad request - self-demotion attempt',
      schema: {
        example: {
          statusCode: 400,
          message: 'You cannot demote yourself from admin status.',
          error: 'Bad Request',
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminSuspendUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Suspend a user',
      description:
        'Suspends a user account, preventing them from accessing the platform. Admin users cannot be suspended.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiOkResponse({
      description: 'User suspended successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'User suspended successfully',
          data: {
            id: 'user-123',
            email: 'user@example.com',
            name: 'John Doe',
            isSuspended: true,
            suspendedAt: '2026-02-23T10:30:00Z',
          },
        },
      },
    }),
    ApiResponse({
      status: 403,
      description: 'Cannot suspend admin users',
      schema: {
        example: {
          statusCode: 403,
          message: 'Cannot suspend admin users',
          error: 'Forbidden',
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
    ApiResponse({
      status: 409,
      description: 'User is already suspended',
      schema: {
        example: {
          statusCode: 409,
          message: 'User is already suspended',
          error: 'Conflict',
        },
      },
    }),
  );
}

export function ApiAdminUnsuspendUser() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Unsuspend a user',
      description:
        'Removes suspension from a user account, restoring their access to the platform.',
    }),
    ApiParam({
      name: 'userId',
      type: String,
      description: 'User ID',
      example: 'user-123-uuid',
    }),
    ApiOkResponse({
      description: 'User unsuspended successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'User unsuspended successfully',
          data: {
            id: 'user-123',
            email: 'user@example.com',
            name: 'John Doe',
            isSuspended: false,
            suspendedAt: null,
          },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: 'User not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'User with ID user-123 not found',
          error: 'Not Found',
        },
      },
    }),
    ApiResponse({
      status: 409,
      description: 'User is not suspended',
      schema: {
        example: {
          statusCode: 409,
          message: 'User is not suspended',
          error: 'Conflict',
        },
      },
    }),
  );
}

export function ApiAdminBulkUserAction() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Bulk user actions',
      description:
        'Perform bulk actions (delete, restore, verify) on multiple users.',
    }),
    ApiBody({
      description: 'Bulk action data',
      schema: {
        example: {
          userIds: ['user-123', 'user-456', 'user-789'],
          action: 'verify',
        },
      },
    }),
    ApiOkResponse({
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
    }),
    ApiResponse({
      status: 400,
      description: 'Invalid action',
      schema: {
        example: {
          statusCode: 400,
          message: 'Invalid action',
          error: 'Bad Request',
        },
      },
    }),
  );
}
