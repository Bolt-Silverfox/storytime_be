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
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AvatarService } from './avatar.service';
import {
  CreateAvatarDto,
  UpdateAvatarDto,
  AssignAvatarDto,
  CreateKidWithAvatarDto,
} from './avatar.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { Public } from '../auth/public.decorator';
import { SuccessResponse } from '../common/dtos/api-response.dto';

@Controller('avatars')
@UseGuards(AuthSessionGuard)
@ApiTags('Avatar')
export class AvatarController {
  constructor(private readonly avatarService: AvatarService) {}
  
  @Public()
  @Get('system')
  @ApiOperation({
    summary: 'Get system avatars',
    description: 'Retrieve all system avatars available for selection. Does not require authentication.',
  })
  @ApiResponse({ status: 200, description: 'System avatars retrieved successfully' })
  async getSystemAvatars() {
    const avatars = await this.avatarService.getSystemAvatars();
    return new SuccessResponse(200, avatars, 'System avatars retrieved successfully');
  }

  @Post('assign/user')
  @ApiOperation({
    summary: 'Assign avatar to user',
    description: 'Assign an existing avatar to a user by providing userId and avatarId.',
  })
  @ApiResponse({ status: 200, description: 'Avatar assigned to user successfully' })
  @ApiResponse({ status: 400, description: 'userId is required' })
  @ApiResponse({ status: 404, description: 'User or avatar not found' })
  async assignAvatarToUser(@Body() assignAvatarDto: AssignAvatarDto) {
    if (!assignAvatarDto.userId) {
      throw new BadRequestException('userId is required');
    }
    
    const user = await this.avatarService.assignAvatarToUser(
      assignAvatarDto.userId,
      assignAvatarDto.avatarId,
    );
    return new SuccessResponse(200, user, 'Avatar assigned to user successfully');
  }

  @Post('assign/kid')
  @ApiOperation({
    summary: 'Assign avatar to kid',
    description: 'Assign an existing avatar to a kid by providing kidId and avatarId.',
  })
  @ApiResponse({ status: 200, description: 'Avatar assigned to kid successfully' })
  @ApiResponse({ status: 400, description: 'kidId is required' })
  @ApiResponse({ status: 404, description: 'Kid or avatar not found' })
  async assignAvatarToKid(@Body() assignAvatarDto: AssignAvatarDto) {
    if (!assignAvatarDto.kidId) {
      throw new BadRequestException('kidId is required');
    }
    
    const kid = await this.avatarService.assignAvatarToKid(
      assignAvatarDto.kidId,
      assignAvatarDto.avatarId,
    );
    return new SuccessResponse(200, kid, 'Avatar assigned to kid successfully');
  }

  @Post('upload/user')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Upload and assign user avatar',
    description: 'Upload a custom avatar image and assign it to a user. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file',
        },
        userId: {
          type: 'string',
          description: 'User ID to assign the avatar to',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'User avatar uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or upload failed' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async uploadUserAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    const user = await this.avatarService.uploadAndAssignUserAvatar(userId, file);
    return new SuccessResponse(200, user, 'User avatar uploaded successfully');
  }

  @Post('upload/kid')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Upload and assign kid avatar',
    description: 'Upload a custom avatar image and assign it to a kid. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file',
        },
        kidId: {
          type: 'string',
          description: 'Kid ID to assign the avatar to',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Kid avatar uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or upload failed' })
  @ApiResponse({ status: 404, description: 'Kid not found' })
  async uploadKidAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('kidId') kidId: string,
  ) {
    const kid = await this.avatarService.uploadAndAssignKidAvatar(kidId, file);
    return new SuccessResponse(200, kid, 'Kid avatar uploaded successfully');
  }

  @Post('create-kid-with-avatar')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Create kid with avatar upload',
    description: 'Create a new kid profile and upload a custom avatar in one operation. Parent ID is automatically taken from authenticated user. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file for the kid',
        },
        name: {
          type: 'string',
          description: 'Kid name (required)',
        },
        ageRange: {
          type: 'string',
          description: 'Age range (optional)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Kid created with avatar successfully' })
  @ApiResponse({ status: 400, description: 'Name is required or invalid file' })
  @ApiResponse({ status: 404, description: 'Parent user not found' })
  async createKidWithAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body('name') name: string,
    @Body('ageRange') ageRange?: string,
  ) {
    if (!name) {
      throw new BadRequestException('name is required');
    }

    // Get parentId from authenticated user
    const parentId = req.authUserData.userId;

    const kid = await this.avatarService.createKidWithAvatar(
      parentId,
      name,
      ageRange,
      file,
    );
    
    return new SuccessResponse(201, kid, 'Kid created with avatar successfully');
  }

  // ADMIN ONLY ENDPOINTS

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List all avatars',
    description: 'Retrieve all avatars in the system. Admin access required.',
  })
  @ApiResponse({ status: 200, description: 'Avatars retrieved successfully' })
  async getAllAvatars() {
    const avatars = await this.avatarService.getAllAvatars();
    return new SuccessResponse(200, avatars, 'Avatars retrieved successfully');
  }

  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Create avatar',
    description: 'Create a new avatar. Can upload an image file or provide a URL. Admin access required. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
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
        },
        url: {
          type: 'string',
          description: 'Avatar image URL (optional if image file is provided)',
        },
        isSystemAvatar: {
          type: 'boolean',
          description: 'Whether this is a system avatar (optional)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Avatar created successfully' })
  @ApiResponse({ status: 400, description: 'Either image file or URL is required' })
  async createAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|gif|webp)' }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() createAvatarDto: CreateAvatarDto,
  ) {
    const avatar = await this.avatarService.createAvatar(createAvatarDto, file);
    return new SuccessResponse(201, avatar, 'Avatar created successfully');
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({
    summary: 'Update avatar',
    description: 'Update an existing avatar. Can update name, URL, or upload a new image. Admin access required. Max file size: 5MB. Supported formats: PNG, JPEG, JPG, GIF, WebP.',
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
        },
        url: {
          type: 'string',
          description: 'Updated avatar image URL (optional)',
        },
        isSystemAvatar: {
          type: 'boolean',
          description: 'Updated system avatar flag (optional)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Avatar updated successfully' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  async updateAvatar(
    @Param('id') id: string,
    @Body() updateAvatarDto: UpdateAvatarDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const avatar = await this.avatarService.updateAvatar(id, updateAvatarDto, file);
    return new SuccessResponse(200, avatar, 'Avatar updated successfully');
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Delete avatar',
    description: 'Delete an avatar. Cannot delete avatars that are currently in use by users or kids. Admin access required.',
  })
  @ApiResponse({ status: 200, description: 'Avatar deleted successfully' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete avatar that is currently in use' })
  async deleteAvatar(@Param('id') id: string) {
    await this.avatarService.deleteAvatar(id);
    return new SuccessResponse(200, null, 'Avatar deleted successfully');
  }
}