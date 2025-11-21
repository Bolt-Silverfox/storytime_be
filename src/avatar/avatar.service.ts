import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import PrismaService from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateAvatarDto, UpdateAvatarDto } from './avatar.dto';
import { SoftDeleteService } from '../common/soft-delete.service';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly softDeleteService: SoftDeleteService,
  ) {}

  async getAllAvatars() {
    return this.prisma.avatar.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSystemAvatars() {
    return this.prisma.avatar.findMany({
      where: { 
        isSystemAvatar: true,
        deletedAt: null 
      },
      orderBy: { name: 'asc' },
    });
  }

  async createAvatar(createAvatarDto: CreateAvatarDto, file: Express.Multer.File) {
    let uploadResult: any;

    if (file) {
      try {
        uploadResult = await this.uploadService.uploadImage(file, 'avatars');
      } catch (error) {
        this.logger.error('Failed to upload image to Cloudinary:', error);
        throw new BadRequestException('Failed to upload image');
      }
    } else if (!createAvatarDto.url) {
      throw new BadRequestException('Either image file or URL is required');
    }

    return this.prisma.avatar.create({
      data: {
        name: createAvatarDto.name,
        url: uploadResult?.secure_url || createAvatarDto.url,
        publicId: uploadResult?.public_id || null,
        isSystemAvatar: createAvatarDto.isSystemAvatar || false,
      },
    });
  }

  async updateAvatar(id: string, updateAvatarDto: UpdateAvatarDto, file?: Express.Multer.File) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id,
        deletedAt: null 
      } 
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    let uploadResult: any;
    let data: any = { ...updateAvatarDto };

    if (file) {
      // Delete old image from Cloudinary if it exists
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

    return this.prisma.avatar.update({
      where: { id },
      data,
    });
  }

  async softDeleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { id },
      include: {
        users: { where: { deletedAt: null } },
        kids: { where: { deletedAt: null } }
      }
    });
    
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // Check if avatar is being used by active (non-deleted) users/kids
    if (avatar.users.length > 0 || avatar.kids.length > 0) {
      throw new BadRequestException('Cannot delete avatar that is currently in use by active users or kids');
    }

    await this.softDeleteService.softDelete('avatar', id);
  }

  async undoDeleteAvatar(id: string): Promise<boolean> {
    return await this.softDeleteService.undoSoftDelete('avatar', id);
  }

  async permanentDeleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ 
      where: { id },
      include: {
        users: { where: { deletedAt: null } },
        kids: { where: { deletedAt: null } }
      }
    });
    
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // Check if avatar is being used by active (non-deleted) users/kids
    if (avatar.users.length > 0 || avatar.kids.length > 0) {
      throw new BadRequestException('Cannot delete avatar that is currently in use by active users or kids');
    }

    // Delete from Cloudinary if it exists
    if (avatar.publicId) {
      try {
        await this.uploadService.deleteImage(avatar.publicId);
      } catch (error) {
        this.logger.warn('Failed to delete image from Cloudinary:', error);
      }
    }

    await this.softDeleteService.permanentDelete('avatar', id);
  }

  async assignAvatarToUser(userId: string, avatarId: string) {
    const user = await this.prisma.user.findUnique({ 
      where: { 
        id: userId,
        deletedAt: null 
      } 
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id: avatarId,
        deletedAt: null 
      } 
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
    const kid = await this.prisma.kid.findUnique({ 
      where: { 
        id: kidId,
        deletedAt: null 
      } 
    });
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const avatar = await this.prisma.avatar.findUnique({ 
      where: { 
        id: avatarId,
        deletedAt: null 
      } 
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
      where: { 
        id: userId,
        deletedAt: null 
      },
      include: { avatar: true }
    });
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Only cleanup if avatarId exists
    if (user.avatarId) {
      await this.cleanupOldCustomAvatar(user.avatarId);
    }

    const avatar = await this.handleCustomAvatarUpload(
      userId, 
      'user', 
      file, 
      user.name || user.email || 'Unknown User'
    );

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }

  async uploadAndAssignKidAvatar(kidId: string, file: Express.Multer.File) {
    const kid = await this.prisma.kid.findUnique({ 
      where: { 
        id: kidId,
        deletedAt: null 
      },
      include: { avatar: true }
    });
    
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Only cleanup if avatarId exists
    if (kid.avatarId) {
      await this.cleanupOldCustomAvatar(kid.avatarId);
    }

    const avatar = await this.handleCustomAvatarUpload(
      kidId, 
      'kid', 
      file, 
      kid.name || 'Unknown Kid'
    );

    return this.prisma.kid.update({
      where: { id: kidId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }

  // Helper Methods
  private async handleCustomAvatarUpload(
    entityId: string, 
    entityType: 'user' | 'kid', 
    file: Express.Multer.File,
    entityName: string
  ) {
    let uploadResult;
    try {
      uploadResult = await this.uploadService.uploadImage(file, 'avatars');
    } catch (error) {
      this.logger.error(`Failed to upload ${entityType} avatar to Cloudinary:`, error);
      throw new BadRequestException('Failed to upload avatar image');
    }

    const avatarName = `${entityType}-avatar-${entityId}`;
    const descriptiveName = `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Avatar - ${entityName}`;
    
    return this.prisma.avatar.upsert({
      where: {
        name: avatarName
      },
      update: {
        name: descriptiveName,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false,
      },
      create: {
        name: descriptiveName,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false,
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
        
        // Only delete if no one else is using this avatar
        const usersUsing = await this.prisma.user.count({ 
          where: { 
            avatarId,
            deletedAt: null 
          } 
        });
        const kidsUsing = await this.prisma.kid.count({ 
          where: { 
            avatarId,
            deletedAt: null 
          } 
        });
        
        if (usersUsing === 0 && kidsUsing === 0) {
          await this.prisma.avatar.delete({ where: { id: avatarId } });
        }
      } catch (error) {
        this.logger.warn('Failed to delete old avatar:', error);
      }
    }
  }
}