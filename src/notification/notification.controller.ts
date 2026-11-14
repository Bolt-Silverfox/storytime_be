import {
  ArgumentMetadata,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Delete,
  ParseArrayPipe,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { NotificationService } from './notification.service';
import { AccessControlService } from '@/shared/access/access-control.service';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  BulkUpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './dto/notification.dto';

const MAX_PREFERENCES_PER_REQUEST = 50;

class BoundedArrayPipe extends ParseArrayPipe {
  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (Array.isArray(value) && value.length > MAX_PREFERENCES_PER_REQUEST) {
      throw new BadRequestException(
        `At most ${MAX_PREFERENCES_PER_REQUEST} preferences per request`,
      );
    }
    return super.transform(value, metadata);
  }
}

const arrayBody = (items: new () => object) =>
  new BoundedArrayPipe({
    items,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

@ApiTags('notification-preferences')
@Controller('notification-preferences')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create notification preferences (bulk)' })
  @ApiBody({ type: [CreateNotificationPreferenceDto] })
  @ApiResponse({ status: 201, type: [NotificationPreferenceDto] })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(arrayBody(CreateNotificationPreferenceDto))
    dtos: CreateNotificationPreferenceDto[],
  ) {
    const scoped: CreateNotificationPreferenceDto[] = [];
    for (const dto of dtos) {
      if (dto.kidId) {
        await this.accessControl.assertKidAccess(req.authUserData, dto.kidId);
        if (dto.userId) {
          this.accessControl.assertSelfOrAdmin(req.authUserData, dto.userId);
        }
        scoped.push(dto);
      } else {
        scoped.push({
          ...dto,
          userId: this.accessControl.resolveUserId(
            req.authUserData,
            dto.userId,
          ),
        });
      }
    }
    return this.notificationService.createMany(scoped);
  }

  @Patch()
  @ApiOperation({ summary: 'Update multiple notification preferences' })
  @ApiBody({ type: [BulkUpdateNotificationPreferenceDto] })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  async bulkUpdate(
    @Req() req: AuthenticatedRequest,
    @Body(arrayBody(BulkUpdateNotificationPreferenceDto))
    dtos: BulkUpdateNotificationPreferenceDto[],
  ) {
    for (const dto of dtos) {
      await this.assertPreferenceAccess(req, dto.id);
    }
    return this.notificationService.bulkUpdate(dtos);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateNotificationPreferenceDto })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationPreferenceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertPreferenceAccess(req, id);
    return this.notificationService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({
    name: 'permanent',
    required: false,
    type: Boolean,
    description:
      'Permanently delete the notification preference (default: false - soft delete)',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification preference deleted successfully',
  })
  async delete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('permanent') permanent: boolean = false,
  ) {
    await this.assertPreferenceAccess(req, id);
    await this.notificationService.delete(id, permanent);
    return { message: 'Notification preference deleted successfully' };
  }

  @Post(':id/undo-delete')
  @ApiOperation({ summary: 'Restore a soft deleted notification preference' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async undoDelete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertPreferenceAccess(req, id);
    return this.notificationService.undoDelete(id);
  }

  @Get('users/:userId')
  @ApiOperation({
    summary: 'Get notification preferences for a user (raw records)',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  async getForUser(
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.accessControl.assertSelfOrAdmin(req.authUserData, userId);
    const prefs = await this.notificationService.getForUser(userId);
    if (this.accessControl.isAdmin(req.authUserData)) return prefs;
    const kidIds = [
      ...new Set(prefs.flatMap((p) => (p.kidId ? [p.kidId] : []))),
    ];
    const accessible = new Set<string>();
    for (const kidId of kidIds) {
      try {
        await this.accessControl.assertKidAccess(req.authUserData, kidId);
        accessible.add(kidId);
      } catch (e) {
        if (!(e instanceof ForbiddenException)) throw e;
      }
    }
    return prefs.filter((p) => !p.kidId || accessible.has(p.kidId));
  }

  @Get('kids/:kidId')
  @ApiOperation({
    summary: 'Get notification preferences for a kid (raw records)',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [NotificationPreferenceDto] })
  async getForKid(
    @Param('kidId') kidId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.accessControl.assertKidAccess(req.authUserData, kidId);
    const prefs = await this.notificationService.getForKid(kidId);
    if (this.accessControl.isAdmin(req.authUserData)) return prefs;
    return prefs.filter(
      (p) => !p.userId || p.userId === req.authUserData.userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a notification preference by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: NotificationPreferenceDto })
  async getById(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.assertPreferenceAccess(req, id);
    return this.notificationService.getById(id);
  }

  private async assertPreferenceAccess(req: AuthenticatedRequest, id: string) {
    try {
      const owner = await this.notificationService.getPreferenceOwner(id);
      if (owner.kidId && owner.userId) {
        await this.accessControl.assertKidAccess(req.authUserData, owner.kidId);
        this.accessControl.assertSelfOrAdmin(req.authUserData, owner.userId);
        return;
      }
      await this.accessControl.assertOwner(req.authUserData, owner);
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw new ForbiddenException('You do not have access to this resource');
      }
      throw e;
    }
  }
}
