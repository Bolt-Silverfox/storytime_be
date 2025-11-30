import { Controller, Post, Patch, Get, Param, Body, Delete, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
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
  @ApiOperation({ summary: 'Create notification preferences (bulk)' })
  @ApiBody({ type: [CreateNotificationPreferenceDto] })
  @ApiResponse({ status: 201, type: [NotificationPreferenceDto] })
  async create(@Body() dtos: CreateNotificationPreferenceDto[]) {
    return Promise.all(dtos.map((dto) => this.notificationService.create(dto)));
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description: 'Permanently delete the notification preference (default: false - soft delete)'
  })
  @ApiResponse({ status: 200, description: 'Notification preference deleted successfully' })
  async delete(
    @Param('id') id: string,
    @Query('permanent') permanent: boolean = false
  ) {
    await this.notificationService.delete(id, permanent);
    return { message: 'Notification preference deleted successfully' };
  }

  @Post(':id/undo-delete')
  @ApiOperation({ summary: 'Restore a soft deleted notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async undoDelete(@Param('id') id: string) {
    return this.notificationService.undoDelete(id);
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