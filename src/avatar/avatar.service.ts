import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import PrismaService from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateAvatarDto, UpdateAvatarDto } from './avatar.dto';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getAllAvatars() {
    return this.prisma.avatar.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSystemAvatars() {
    return this.prisma.avatar.findMany({
      where: { isSystemAvatar: true },
      orderBy: { createdAt: 'asc' },
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
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
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
          // Continue with upload even if delete fails
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

  async deleteAvatar(id: string) {
    const avatar = await this.prisma.avatar.findUnique({ where: { id } });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // Check if avatar is being used
    const usersUsing = await this.prisma.user.count({ where: { avatarId: id } });
    const kidsUsing = await this.prisma.kid.count({ where: { avatarId: id } });

    if (usersUsing > 0 || kidsUsing > 0) {
      throw new BadRequestException('Cannot delete avatar that is currently in use');
    }

    // Delete from Cloudinary if it exists
    if (avatar.publicId) {
      try {
        await this.uploadService.deleteImage(avatar.publicId);
      } catch (error) {
        this.logger.warn('Failed to delete image from Cloudinary:', error);
        // Continue with database deletion even if Cloudinary delete fails
      }
    }

    return this.prisma.avatar.delete({ where: { id } });
  }

  async assignAvatarToUser(userId: string, avatarId: string) {
    // Verify user exists
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify avatar exists
    const avatar = await this.prisma.avatar.findUnique({ where: { id: avatarId } });
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
    // Verify kid exists
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify avatar exists
    const avatar = await this.prisma.avatar.findUnique({ where: { id: avatarId } });
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete old avatar if it was a custom upload (has publicId)
    if (user.avatarId) {
      const oldAvatar = await this.prisma.avatar.findUnique({
        where: { id: user.avatarId },
      });
      if (oldAvatar && oldAvatar.publicId && !oldAvatar.isSystemAvatar) {
        try {
          await this.uploadService.deleteImage(oldAvatar.publicId);
          await this.prisma.avatar.delete({ where: { id: user.avatarId } });
        } catch (error) {
          this.logger.warn('Failed to delete old user avatar:', error);
          // Continue with new upload
        }
      }
    }

    let uploadResult;
    try {
      uploadResult = await this.uploadService.uploadImage(file, 'avatars');
    } catch (error) {
      this.logger.error('Failed to upload user avatar to Cloudinary:', error);
      throw new BadRequestException('Failed to upload avatar image');
    }
    
    const avatar = await this.prisma.avatar.create({
      data: {
        name: `User Avatar - ${user.name || user.email}`,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false,
      },
    });

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }

  async uploadAndAssignKidAvatar(kidId: string, file: Express.Multer.File) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Delete old avatar if it was a custom upload (has publicId)
    if (kid.avatarId) {
      const oldAvatar = await this.prisma.avatar.findUnique({
        where: { id: kid.avatarId },
      });
      if (oldAvatar && oldAvatar.publicId && !oldAvatar.isSystemAvatar) {
        try {
          await this.uploadService.deleteImage(oldAvatar.publicId);
          await this.prisma.avatar.delete({ where: { id: kid.avatarId } });
        } catch (error) {
          this.logger.warn('Failed to delete old kid avatar:', error);
          // Continue with new upload
        }
      }
    }

    let uploadResult;
    try {
      uploadResult = await this.uploadService.uploadImage(file, 'avatars');
    } catch (error) {
      this.logger.error('Failed to upload kid avatar to Cloudinary:', error);
      throw new BadRequestException('Failed to upload avatar image');
    }
    
    const avatar = await this.prisma.avatar.create({
      data: {
        name: `Kid Avatar - ${kid.name}`,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false,
      },
    });

    return this.prisma.kid.update({
      where: { id: kidId },
      data: { avatarId: avatar.id },
      include: { avatar: true },
    });
  }
}