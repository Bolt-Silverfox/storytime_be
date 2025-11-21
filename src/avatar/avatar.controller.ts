import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AvatarService } from './avatar.service';
import {
  CreateAvatarDto,
  UpdateAvatarDto,
  AssignAvatarDto,
} from './avatar.dto';
import { AuthSessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SuccessResponse } from '../common/dtos/api-response.dto';

@Controller('avatars')
@UseGuards(AuthSessionGuard) 
export class AvatarController {
  constructor(private readonly avatarService: AvatarService) {}
  
  @Get('system')
  async getSystemAvatars() {
    const avatars = await this.avatarService.getSystemAvatars();
    return new SuccessResponse(200, avatars, 'System avatars retrieved successfully');
  }

  @Post('assign/user')
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

  // ADMIN ONLY ENDPOINTS

  @Get()
  @UseGuards(AdminGuard) 
   async getAllAvatars() {
    const avatars = await this.avatarService.getAllAvatars();
    return new SuccessResponse(200, avatars, 'Avatars retrieved successfully');
  }

  @Post()
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('image'))
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
  async updateAvatar(
    @Param('id') id: string,
    @Body() updateAvatarDto: UpdateAvatarDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const avatar = await this.avatarService.updateAvatar(id, updateAvatarDto, file);
    return new SuccessResponse(200, avatar, 'Avatar updated successfully');
  }

  // SOFT DELETE
  @Delete(':id')
  @UseGuards(AdminGuard) 
  async deleteAvatar(@Param('id') id: string) {
    await this.avatarService.softDeleteAvatar(id);
    return new SuccessResponse(200, null, 'Avatar soft deleted successfully');
  }

  // UNDO DELETE
  @Post(':id/undo-delete')
  @UseGuards(AdminGuard)
  async undoDeleteAvatar(@Param('id') id: string) {
    const result = await this.avatarService.undoDeleteAvatar(id);
    if (!result) {
      throw new BadRequestException('Cannot undo deletion. Either avatar not found or undo window (30s) has expired.');
    }
    return new SuccessResponse(200, null, 'Avatar deletion undone successfully');
  }

  // PERMANENT DELETE
  @Delete(':id/permanent')
  @UseGuards(AdminGuard)
  async permanentDeleteAvatar(@Param('id') id: string) {
    await this.avatarService.permanentDeleteAvatar(id);
    return new SuccessResponse(200, null, 'Avatar permanently deleted successfully');
  }
}