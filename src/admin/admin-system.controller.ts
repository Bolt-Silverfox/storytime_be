import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminSystemService } from './admin-system.service';
import { Admin } from './decorators/admin.decorator';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { GuestActivityFilterDto } from './dto/guest-stats.dto';
import { PaginationUtil } from '../shared/utils/pagination.util';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
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
export class AdminSystemController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminSystemService: AdminSystemService,
  ) {}

  // =====================
  // SUBSCRIPTION MANAGEMENT
  // =====================

  @Get('subscriptions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all subscriptions',
    description:
      'Returns all subscriptions with user details. Optional status filter.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by subscription status',
    example: 'active',
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
              name: 'John Doe',
            },
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
              name: 'Jane Smith',
            },
          },
        ],
      },
    },
  })
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Seed database',
    description:
      'Seeds the database with initial categories, themes, avatars, and age groups.',
  })
  @ApiOkResponse({
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
  })
  @ApiResponse({
    status: 400,
    description: 'Failed to seed database',
    schema: {
      example: {
        statusCode: 400,
        message: 'Failed to seed database',
        error: 'Bad Request',
      },
    },
  })
  async seedDatabase() {
    const data = await this.adminService.seedDatabase();
    return {
      statusCode: 200,
      message: 'Database seeded successfully',
      data,
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
          timestamp: '2023-10-15T10:30:00Z',
        },
      },
    },
  })
  createBackup() {
    const data = this.adminSystemService.createBackup();
    return {
      statusCode: 200,
      message: 'Backup created successfully',
      data,
    };
  }

  @Get('logs')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get system logs',
    description:
      'Returns system activity logs with optional filtering by log level.',
  })
  @ApiQuery({
    name: 'level',
    required: false,
    type: String,
    description: 'Filter by log level',
    example: 'SUCCESS',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of logs to return (default: 100, max: 500)',
    example: 100,
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
              name: 'John Doe',
            },
          },
        ],
      },
    },
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
      data,
    };
  }

  // =====================
  // INTEGRATIONS
  // =====================

  @Get('integrations/elevenlabs/balance')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ElevenLabs credit balance' })
  async getElevenLabsBalance() {
    const data = await this.adminSystemService.getElevenLabsBalance();
    return {
      statusCode: 200,
      message: 'ElevenLabs balance retrieved',
      data,
    };
  }

  // =====================
  // BROADCAST NOTIFICATIONS
  // =====================

  @Post('notifications/broadcast')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Broadcast push notification to all users' })
  @ApiBody({ type: BroadcastNotificationDto })
  @ApiCreatedResponse({ description: 'Notification queued for broadcast' })
  @HttpCode(HttpStatus.CREATED)
  async broadcastNotification(@Body() dto: BroadcastNotificationDto) {
    const data = await this.adminService.broadcastNotification(dto);
    return {
      statusCode: 201,
      message: 'Broadcast notification queued',
      data,
    };
  }

  @Post('notifications/seed-topic')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subscribe all existing devices to a topic (one-time seed)',
  })
  @ApiQuery({ name: 'topic', required: false, example: 'all_users' })
  @ApiCreatedResponse({ description: 'Topic seed initiated' })
  @HttpCode(HttpStatus.CREATED)
  async seedTopicSubscriptions(@Query('topic') topic?: string) {
    const data = await this.adminService.seedTopicSubscriptions(topic);
    return {
      statusCode: 201,
      message: 'Topic subscription seed initiated',
      data,
    };
  }

  // =====================
  // GUEST ANALYTICS
  // =====================

  @Get('guests/activity')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get guest activity log' })
  @ApiResponse({
    status: 200,
    description: 'Guest activity retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getGuestActivity(@Query() filters: GuestActivityFilterDto) {
    const result = await this.adminService.getGuestActivity(filters);
    return {
      statusCode: 200,
      message: 'Guest activity retrieved successfully',
      ...result,
    };
  }
}
