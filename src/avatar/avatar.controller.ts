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
  BadRequestException,
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
import {
  CreateAvatarDto,
  UpdateAvatarDto,
  AssignAvatarDto,
} from './dto/avatar.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { Public } from '@/shared/decorators/public.decorator';
import { SuccessResponse } from '@/shared/dtos/api-response.dto';

@Controller('avatars')
@UseGuards(AuthSessionGuard)
export class AvatarController {
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

  @Post('assign/user')
  @ApiOperation({
    summary: 'Assign avatar to user',
    description:
      'Assign an existing avatar to a user by providing userId and avatarId.',
  })
  @ApiBody({
    type: AssignAvatarDto,
    examples: {
      example1: {
        summary: 'Assign avatar to user',
        value: {
          userId: 'user-123',
          avatarId: 'avatar-456',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar assigned to user successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Avatar assigned to user successfully',
        data: {
          user: {
            id: 'user-123',
            email: 'test@gmail.com',
            name: 'John Doe',
            avatar: {
              id: 'avatar-456',
              name: 'Cool Avatar',
              url: 'https://avatar.com/new-avatar.png',
              isSystemAvatar: false,
              publicId: 'public_id_456',
              createdAt: '2023-10-01T12:00:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            role: 'user',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-02T10:30:00Z',
            title: 'Mr',
            profile: {
              id: 'profile-123',
              explicitContent: false,
              maxScreenTimeMins: 120,
              language: 'english',
              country: 'nigeria',
              createdAt: '2023-10-01T12:00:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            numberOfKids: 2,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'userId is required',
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
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'User or avatar not found',
        statusCode: 404,
        details: {},
      },
    },
  })
  async assignAvatarToUser(@Body() assignAvatarDto: AssignAvatarDto) {
    if (!assignAvatarDto.userId) {
      throw new BadRequestException('userId is required');
    }

    const user = await this.avatarService.assignAvatarToUser(
      assignAvatarDto.userId,
      assignAvatarDto.avatarId,
    );
    return new SuccessResponse(
      200,
      { user },
      'Avatar assigned to user successfully',
    );
  }

  @Post('assign/kid')
  @ApiOperation({
    summary: 'Assign avatar to kid',
    description:
      'Assign an existing avatar to a kid by providing kidId and avatarId.',
  })
  @ApiBody({
    type: AssignAvatarDto,
    examples: {
      example1: {
        summary: 'Assign avatar to kid',
        value: {
          kidId: 'kid-123',
          avatarId: 'avatar-456',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar assigned to kid successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Avatar assigned to kid successfully',
        data: {
          kid: {
            id: 'kid-123',
            name: 'Little John',
            ageRange: '3-5',
            avatar: {
              id: 'avatar-456',
              name: 'Kids Avatar',
              url: 'https://avatar.com/kid-avatar.png',
              isSystemAvatar: true,
              publicId: 'public_id_456',
              createdAt: '2023-10-01T12:00:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            parentId: 'user-123',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-02T10:30:00Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'kidId is required',
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
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'Kid or avatar not found',
        statusCode: 404,
        details: {},
      },
    },
  })
  async assignAvatarToKid(@Body() assignAvatarDto: AssignAvatarDto) {
    if (!assignAvatarDto.kidId) {
      throw new BadRequestException('kidId is required');
    }

    const kid = await this.avatarService.assignAvatarToKid(
      assignAvatarDto.kidId,
      assignAvatarDto.avatarId,
    );
    return new SuccessResponse(
      200,
      { kid },
      'Avatar assigned to kid successfully',
    );
  }

  @Post('upload/user')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Upload and assign user avatar',
    description:
      'Upload a custom avatar image and assign it to a user. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (required)',
        },
        userId: {
          type: 'string',
          description: 'User ID to assign the avatar to (required)',
          example: 'user-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User avatar uploaded successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'User avatar uploaded successfully',
        data: {
          user: {
            id: 'user-123',
            email: 'test@gmail.com',
            name: 'John Doe',
            avatar: {
              id: 'avatar-new-123',
              name: 'Custom Uploaded Avatar',
              url: 'https://cloudinary.com/uploaded-avatar.png',
              isSystemAvatar: false,
              publicId: 'uploaded_public_id_123',
              createdAt: '2023-10-02T10:30:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            role: 'user',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-02T10:30:00Z',
            title: 'Mr',
            profile: {
              id: 'profile-123',
              explicitContent: false,
              maxScreenTimeMins: 120,
              language: 'english',
              country: 'nigeria',
              createdAt: '2023-10-01T12:00:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            numberOfKids: 2,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'Invalid file or upload failed',
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
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'User not found',
        statusCode: 404,
        details: {},
      },
    },
  })
  async uploadUserAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    const user = await this.avatarService.uploadAndAssignUserAvatar(
      userId,
      file,
    );
    return new SuccessResponse(200, user, 'User avatar uploaded successfully');
  }

  @Post('upload/kid')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Upload and assign kid avatar',
    description:
      'Upload a custom avatar image and assign it to a kid. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kidId'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (required)',
        },
        kidId: {
          type: 'string',
          description: 'Kid ID to assign the avatar to (required)',
          example: 'kid-456',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Kid avatar uploaded successfully',
    schema: {
      example: {
        statusCode: 200,
        message: 'Kid avatar uploaded successfully',
        data: {
          kid: {
            id: 'kid-456',
            name: 'Sarah Johnson',
            ageRange: '6-8',
            avatar: {
              id: 'avatar-kid-new-456',
              name: 'Kids Custom Avatar',
              url: 'https://cloudinary.com/kid-uploaded-avatar.png',
              isSystemAvatar: false,
              publicId: 'kid_uploaded_public_id_456',
              createdAt: '2023-10-02T10:30:00Z',
              updatedAt: '2023-10-02T10:30:00Z',
            },
            parentId: 'user-123',
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-02T10:30:00Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    schema: {
      example: {
        message: 'Invalid file or upload failed',
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
    status: 404,
    description: 'Not Found',
    schema: {
      example: {
        message: 'Kid not found',
        statusCode: 404,
        details: {},
      },
    },
  })
  async uploadKidAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('kidId') kidId: string,
  ) {
    const kid = await this.avatarService.uploadAndAssignKidAvatar(kidId, file);
    return new SuccessResponse(
      200,
      { kid },
      'Kid avatar uploaded successfully',
    );
  }

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
