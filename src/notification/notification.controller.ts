import { Controller, Post, Patch, Get, Param, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './notification.dto';

@ApiTags('notification-preferences')
@Controller('notification-preferences')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a notification preference' })
  @ApiBody({ type: CreateNotificationPreferenceDto })
  @ApiResponse({ status: 201, type: NotificationPreferenceDto })
  async create(@Body() dto: CreateNotificationPreferenceDto) {
    return this.notificationService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateNotificationPreferenceDto })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationService.update(id, dto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get notification preferences for a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  async getForUser(@Param('userId') userId: string) {
    return this.notificationService.getForUser(userId);
  }

  @Get('kid/:kidId')
  @ApiOperation({ summary: 'Get notification preferences for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  async getForKid(@Param('kidId') kidId: string) {
    return this.notificationService.getForKid(kidId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification preference by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async getById(@Param('id') id: string) {
    return this.notificationService.getById(id);
  }
}
