import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from '@/shared/constants/upload.constants';
import { AvatarService } from './avatar.service';
import { CreateAvatarDto, UpdateAvatarDto } from './dto/avatar.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

@Controller('avatars')
@UseGuards(AuthSessionGuard)
export class AvatarCoreController {
  constructor(private readonly avatarService: AvatarService) {}

  // ADMIN ONLY ENDPOINTS

  @Get()
  @UseGuards(AdminGuard)
  async getAllAvatars() {
    const avatars = await this.avatarService.getAllAvatars();
    return new SuccessResponse(200, avatars, 'Avatars retrieved successfully');
  }

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Create avatar',
    description:
      'Create a new avatar. For non-admin users, avatars are created as custom avatars. For admin users, avatars are created as system avatars. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (optional if URL is provided)',
        },
        name: {
          type: 'string',
          description: 'Avatar name (optional)',
          example: 'Cool Avatar',
        },
        url: {
          type: 'string',
          description: 'Avatar image URL (optional if image file is provided)',
          example: 'https://example.com/avatar.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Avatar created successfully',
    schema: {
      example: {
        statusCode: 201,
        message: 'Avatar created successfully',
        data: {
          id: 'avatar-new-999',
          name: 'New Custom Avatar',
          url: 'https://example.com/new-avatar.png',
          isSystemAvatar: false,
          publicId: 'new_public_id_999',
          isDeleted: false,
          deletedAt: null,
          createdAt: '2023-10-02T10:30:00Z',
          updatedAt: '2023-10-02T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'Either image file or URL is required',
        statusCode: 400,
        details: {},
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
  async createAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES }),
        ],
        fileIsRequired: false,
      }),
    )
    file: Express.Multer.File,
    @Body() createAvatarDto: CreateAvatarDto,
  ) {
    const isAdmin = req.authUserData.userRole === 'admin';

    // Determine isSystemAvatar based on user role
    const isSystemAvatar = isAdmin;

    const avatar = await this.avatarService.createAvatar(
      createAvatarDto,
      file,
      isSystemAvatar,
    );

    const message = isAdmin
      ? 'System avatar created successfully'
      : 'Avatar created successfully';

    return new SuccessResponse(201, avatar, message);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Update system avatar',
    description:
      'Update an existing system avatar. Admin access required. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'New avatar image file (optional)',
        },
        name: {
          type: 'string',
          description: 'Updated avatar name (optional)',
          example: 'Updated Avatar Name',
        },
        url: {
          type: 'string',
          description: 'Updated avatar image URL (optional)',
          example: 'https://example.com/new-avatar.png',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'System avatar updated successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'System avatar updated successfully',
        data: {
          id: 'avatar-123',
          name: 'Updated Avatar Name',
          url: 'https://example.com/updated-avatar.png',
          isSystemAvatar: true,
          publicId: 'updated_public_id_123',
          isDeleted: false,
          deletedAt: null,
          createdAt: '2023-10-01T12:00:00Z',
          updatedAt: '2023-10-02T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'Cannot update non-system avatar',
        statusCode: 400,
        details: {},
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
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'System avatar not found',
        statusCode: 404,
        details: {},
      },
    },
  })
  async updateAvatar(
    @Param('id') id: string,
    @Body() updateAvatarDto: UpdateAvatarDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES }),
        ],
        fileIsRequired: false,
      }),
    )
    file?: Express.Multer.File,
  ) {
    const avatar = await this.avatarService.updateAvatar(
      id,
      updateAvatarDto,
      file,
    );
    return new SuccessResponse(200, avatar, 'Avatar updated successfully');
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async deleteAvatar(@Param('id') id: string) {
    await this.avatarService.softDeleteAvatar(id);
    return new SuccessResponse(200, null, 'Avatar deleted successfully');
  }
}
