import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateAvatarDto, UpdateAvatarDto } from './dto/avatar.dto';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  // Helper Methods
  private async handleCustomAvatarUpload(
    entityId: string,
    entityType: 'user' | 'kid',
    file: Express.Multer.File,
    entityName: string,
  ) {
    let uploadResult;
    try {
      uploadResult = await this.uploadService.uploadImage(file, 'avatars');
    } catch (error) {
      this.logger.error(
        `Failed to upload ${entityType} avatar to Cloudinary:`,
        error,
      );
      throw new BadRequestException('Failed to upload avatar image');
    }

    const avatarName = `${entityType}-avatar-${entityId}`;

    return this.prisma.avatar.upsert({
      where: {
        name: avatarName,
      },
      update: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false, // Custom avatars are always non-system
        isDeleted: false, // Ensure it's not marked as deleted
        deletedAt: null,
      },
      create: {
        name: avatarName,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false, // Custom avatars are always non-system
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  private async cleanupOldCustomAvatar(avatarId: string) {
    const oldAvatar = await this.prisma.avatar.findUnique({
      where: { id: avatarId },
    });

    if (oldAvatar && oldAvatar.publicId && !oldAvatar.isSystemAvatar) {
      try {
        await this.uploadService.deleteImage(oldAvatar.publicId);

        const usersUsing = await this.prisma.user.count({
          where: { avatarId },
        });
        const kidsUsing = await this.prisma.kid.count({ where: { avatarId } });

        if (usersUsing === 0 && kidsUsing === 0) {
          await this.prisma.avatar.delete({ where: { id: avatarId } });
        }
      } catch (error) {
        this.logger.warn('Failed to delete old avatar:', error);
      }
    }
  }

  async getAllSystemAvatars() {
    return await this.prisma.avatar.findMany({
      where: { 
        isSystemAvatar: true 
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSystemAvatars() {
    return await this.prisma.avatar.findMany({
      where: { 
        isSystemAvatar: true,
        isDeleted: false 
      },
      orderBy: { name: 'asc' },
    });
  }

  async getAllAvatars(includeDeleted: boolean = false) {
    const where = includeDeleted ? {} : { isDeleted: false };
    
    return await this.prisma.avatar.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAvatar(
    createAvatarDto: CreateAvatarDto,
    file: Express.Multer.File,
    isSystemAvatar: boolean = false,
    createdByUserId?: string,
  ) {
    let uploadResult: any;

    if (file) {
      try {
        uploadResult = await this.uploadService.uploadImage(file, 'avatars');
      } catch (error) {
        this.logger.error('Failed to upload image to Cloudinary:', error);
        throw new BadRequestException('Failed to upload image');
      }
    } else if (!createAvatarDto.url && isSystemAvatar) {
      // For system avatars, either file or URL is required
      throw new BadRequestException('Either image file or URL is required for system avatars');
    } else if (!file && !isSystemAvatar) {
      // For custom avatars, file is required
      throw new BadRequestException('Image file is required for custom avatars');
    }

    // Generate avatar name
    const avatarName = createAvatarDto.name || 
      (isSystemAvatar ? 'System Avatar' : `Custom Avatar - ${new Date().toISOString()}`);

    return this.prisma.avatar.create({
      data: {
        name: avatarName,
        url: uploadResult?.secure_url || createAvatarDto.url,
        publicId: uploadResult?.public_id || null,
        isSystemAvatar: isSystemAvatar,
        isDeleted: false,
        deletedAt: null,
        // Track who created the avatar
        ...(createdByUserId && { createdBy: createdByUserId }),
      },
    });
  }

  async updateAvatar(
    id: string,
    updateAvatarDto: UpdateAvatarDto,
    file?: Express.Multer.File,
  ) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id,
        isDeleted: false 
      } 
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    let uploadResult: any;
    let data: any = { ...updateAvatarDto };

    if (file) {
      if (avatar.publicId) {
        try {
          await this.uploadService.deleteImage(avatar.publicId);
        } catch (error) {
          this.logger.warn('Failed to delete old image from Cloudinary:', error);
        }
      }

      try {
        uploadResult = await this.uploadService.uploadImage(file, 'avatars');
        data.url = uploadResult.secure_url;
        data.publicId = uploadResult.public_id;
      } catch (error) {
        this.logger.error('Failed to upload new image to Cloudinary:', error);
        throw new BadRequestException('Failed to upload new image');
      }
    }

    return await this.prisma.avatar.update({
      where: { id },
      data,
    });
  }

  async updateSystemAvatar(
    id: string,
    updateAvatarDto: UpdateAvatarDto,
    file?: Express.Multer.File,
  ) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id,
        isDeleted: false 
      } 
    });
    if (!avatar) {
      throw new NotFoundException('System avatar not found');
    }

    if (!avatar.isSystemAvatar) {
      throw new BadRequestException('Cannot update non-system avatar');
    }

    return this.updateAvatar(id, updateAvatarDto, file);
  }

  async softDeleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id,
        isDeleted: false 
      } 
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // For system avatars, check if they're in use
    if (avatar.isSystemAvatar) {
      const usersUsing = await this.prisma.user.count({
        where: { avatarId: id },
      });
      const kidsUsing = await this.prisma.kid.count({ where: { avatarId: id } });

      if (usersUsing > 0 || kidsUsing > 0) {
        throw new BadRequestException(
          'Cannot delete avatar that is currently in use',
        );
      }
    }

    return await this.prisma.avatar.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async permanentDeleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // For system avatars, check if they're in use
    if (avatar.isSystemAvatar) {
      const usersUsing = await this.prisma.user.count({
        where: { avatarId: id },
      });
      const kidsUsing = await this.prisma.kid.count({ where: { avatarId: id } });

      if (usersUsing > 0 || kidsUsing > 0) {
        throw new BadRequestException(
          'Cannot delete avatar that is currently in use',
        );
      }
    }

    if (avatar.publicId) {
      try {
        await this.uploadService.deleteImage(avatar.publicId);
      } catch (error) {
        this.logger.warn('Failed to delete image from Cloudinary:', error);
      }
    }

    return await this.prisma.avatar.delete({ where: { id } });
  }

  async restoreAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { id } 
    });
    
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    if (!avatar.isDeleted) {
      return avatar; // Already not deleted
    }

    return await this.prisma.avatar.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async assignAvatarToUser(userId: string, avatarId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.prisma.avatar.findUnique({
      where: { 
        id: avatarId,
        isDeleted: false 
      },
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarId },
      include: { avatar: true },
    });
  }

  async assignAvatarToKid(kidId: string, avatarId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const avatar = await this.prisma.avatar.findUnique({
      where: { 
        id: avatarId,
        isDeleted: false 
      },
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return this.prisma.kid.update({
      where: { id: kidId },
      data: { avatarId },
      include: { avatar: true },
    });
  }

  async uploadAndAssignUserAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.avatarId) {
      await this.cleanupOldCustomAvatar(user.avatarId);
    }

    const avatar = await this.handleCustomAvatarUpload(
      userId,
      'user',
      file,
      user.name || user.email || 'Unknown User',
    );

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }

  async uploadAndAssignKidAvatar(kidId: string, file: Express.Multer.File) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    if (kid.avatarId) {
      await this.cleanupOldCustomAvatar(kid.avatarId);
    }

    const avatar = await this.handleCustomAvatarUpload(
      kidId,
      'kid',
      file,
      kid.name || 'Unknown Kid',
    );

    return this.prisma.kid.update({
      where: { id: kidId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }
}