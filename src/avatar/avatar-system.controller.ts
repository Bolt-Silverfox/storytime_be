import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AvatarService } from './avatar.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { Public } from '@/shared/decorators/public.decorator';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

@Controller('avatars')
@UseGuards(AuthSessionGuard)
export class AvatarSystemController {
  constructor(private readonly avatarService: AvatarService) {}

  @Get('system')
  @ApiOperation({
    summary: 'Get available system avatars',
    description:
      'Retrieve all system avatars that are available (not deleted). Does not require authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'System avatars retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'System avatars retrieved successfully',
        data: [
          {
            id: 'avatar-123',
            name: 'Default Avatar',
            url: 'https://example.com/avatar1.png',
            isSystemAvatar: true,
            publicId: 'public_id_123',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-01T12:00:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'Error message',
        statusCode: 400,
        details: {},
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'Error message',
        statusCode: 404,
        details: {},
      },
    },
  })
  @Public()
  async getSystemAvatars() {
    const avatars = await this.avatarService.getSystemAvatars();
    return new SuccessResponse(
      200,
      avatars,
      'System avatars retrieved successfully',
    );
  }

  // ADMIN ONLY ENDPOINTS

  @Get('system/all')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List all system avatars',
    description:
      'Retrieve all system avatars including deleted ones. Admin access required.',
  })
  @ApiResponse({
    status: 200,
    description: 'System avatars retrieved successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'System avatars retrieved successfully',
        data: [
          {
            id: 'avatar-123',
            name: 'System Avatar 1',
            url: 'https://example.com/avatar1.png',
            isSystemAvatar: true,
            publicId: 'public_id_123',
            isDeleted: false,
            deletedAt: null,
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-01T12:00:00Z',
          },
          {
            id: 'avatar-456',
            name: 'Deleted Avatar',
            url: 'https://example.com/deleted-avatar.png',
            isSystemAvatar: true,
            publicId: 'public_id_456',
            isDeleted: true,
            deletedAt: '2023-10-02T10:30:00Z',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-02T10:30:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: {
      example: {
        message: 'Unauthorized',
        statusCode: 401,
        details: {},
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
    schema: {
      example: {
        message: 'Forbidden resource',
        statusCode: 403,
        details: {},
      },
    },
  })
  async getAllSystemAvatars() {
    const avatars = await this.avatarService.getAllSystemAvatars();
    return new SuccessResponse(
      200,
      avatars,
      'System avatars retrieved successfully',
    );
  }
}
