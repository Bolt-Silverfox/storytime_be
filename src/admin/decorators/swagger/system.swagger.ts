import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';

export function ApiAdminGetSystemHealth() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get system health status',
      description:
        'Returns system health metrics including database connectivity, response time, uptime, and memory utilization.',
    }),
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetRecentActivity() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get recent activity logs',
      description: 'Returns recent system activity logs with user information.',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of activity logs to return (default: 50, max: 100)',
      example: 50,
    }),
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetDeletionRequests() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List account deletion requests',
      description:
        'Returns parsed list of account deletion requests including reasons and notes.',
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
    ApiOkResponse({
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
    }),
  );
}

export function ApiAdminGetSubscriptions() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List all subscriptions',
      description:
        'Returns all subscriptions with user details. Optional status filter.',
    }),
    ApiQuery({
      name: 'status',
      required: false,
      type: String,
      description: 'Filter by subscription status',
      example: 'active',
    }),
    ApiOkResponse({
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
                name: 'John Doe',
              },
            },
          ],
        },
      },
    }),
  );
}

export function ApiAdminSeedDatabase() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Seed database',
      description:
        'Seeds the database with initial categories, themes, avatars, and age groups.',
    }),
    ApiOkResponse({
      description: 'Database seeded successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Database seeded successfully',
          data: {
            message: 'Database seeded successfully',
          },
        },
      },
    }),
    ApiResponse({
      status: 400,
      description: 'Failed to seed database',
      schema: {
        example: {
          statusCode: 400,
          message: 'Failed to seed database',
          error: 'Bad Request',
        },
      },
    }),
  );
}

export function ApiAdminCreateBackup() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Create database backup',
      description: 'Generates a database backup file.',
    }),
    ApiOkResponse({
      description: 'Backup created successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Backup created successfully',
          data: {
            message: 'Backup created successfully',
            timestamp: '2023-10-15T10:30:00Z',
          },
        },
      },
    }),
  );
}

export function ApiAdminGetSystemLogs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get system logs',
      description:
        'Returns system activity logs with optional filtering by log level.',
    }),
    ApiQuery({
      name: 'level',
      required: false,
      type: String,
      description: 'Filter by log level',
      example: 'SUCCESS',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of logs to return (default: 100, max: 500)',
      example: 100,
    }),
    ApiOkResponse({
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
                name: 'John Doe',
              },
            },
          ],
        },
      },
    }),
  );
}

export function ApiAdminGetElevenLabsBalance() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get ElevenLabs credit balance' }),
  );
}

export function ApiAdminGetAllSupportTickets() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'List all support tickets' }),
    ApiQuery({ name: 'page', required: false }),
    ApiQuery({ name: 'limit', required: false }),
    ApiQuery({ name: 'status', required: false }),
  );
}

export function ApiAdminUpdateSupportTicket() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Update support ticket status' }),
    ApiBody({
      schema: {
        type: 'object',
        properties: { status: { type: 'string', example: 'resolved' } },
      },
    }),
  );
}
