import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { UploadService } from '../upload/upload.service';
import { CreateAvatarDto, UpdateAvatarDto } from './dto/avatar.dto';
import { IAvatarRepository, AVATAR_REPOSITORY } from './repositories';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  constructor(
    @Inject(AVATAR_REPOSITORY)
    private readonly avatarRepository: IAvatarRepository,
    private readonly uploadService: UploadService,
  ) {}

  // Helper Methods

  private async handleCustomAvatarUpload(
    entityId: string,
    entityType: 'user' | 'kid',
    file: Express.Multer.File,
    entityName: string, // eslint-disable-line @typescript-eslint/no-unused-vars
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

    return this.avatarRepository.upsertByName(avatarName, {
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      isSystemAvatar: false,
    });
  }

  private async cleanupOldCustomAvatar(avatarId: string) {
    const oldAvatar = await this.avatarRepository.findById(avatarId);

    if (oldAvatar && oldAvatar.publicId && !oldAvatar.isSystemAvatar) {
      try {
        await this.uploadService.deleteImage(oldAvatar.publicId);

        const usersUsing = await this.avatarRepository.countUsersUsingAvatar(avatarId);
        const kidsUsing = await this.avatarRepository.countKidsUsingAvatar(avatarId);

        if (usersUsing === 0 && kidsUsing === 0) {
          await this.avatarRepository.hardDelete(avatarId);
        }
      } catch (error) {
        this.logger.warn('Failed to delete old avatar:', error);
      }
    }
  }

  async getAllSystemAvatars() {
    return this.avatarRepository.findAllSystemAvatars();
  }

  async getSystemAvatars() {
    return this.avatarRepository.findSystemAvatars();
  }

  async getAllAvatars(includeDeleted: boolean = false) {
    return this.avatarRepository.findAll(includeDeleted);
  }

  async createAvatar(
    createAvatarDto: CreateAvatarDto,
    file: Express.Multer.File,
    isSystemAvatar: boolean = false,
    createdByUserId?: string,
  ) {
    let uploadResult: { secure_url: string; public_id: string } | undefined;

    if (file) {
      try {
        uploadResult = await this.uploadService.uploadImage(file, 'avatars');
      } catch (error) {
        this.logger.error('Failed to upload image to Cloudinary:', error);
        throw new BadRequestException('Failed to upload image');
      }
    } else if (!createAvatarDto.url && isSystemAvatar) {
      // For system avatars, either file or URL is required
      throw new BadRequestException(
        'Either image file or URL is required for system avatars',
      );
    } else if (!file && !isSystemAvatar) {
      // For custom avatars, file is required
      throw new BadRequestException(
        'Image file is required for custom avatars',
      );
    }

    // Generate avatar name
    const avatarName =
      createAvatarDto.name ||
      (isSystemAvatar
        ? 'System Avatar'
        : `Custom Avatar - ${new Date().toISOString()}`);

    // URL is guaranteed by validation above (file upload or provided URL)
    const avatarUrl = uploadResult?.secure_url || createAvatarDto.url;
    if (!avatarUrl) {
      throw new BadRequestException('Avatar URL is required');
    }

    return this.avatarRepository.create({
      name: avatarName,
      url: avatarUrl,
      publicId: uploadResult?.public_id || null,
      isSystemAvatar: isSystemAvatar,
      createdBy: createdByUserId,
    });
  }

  async updateAvatar(
    id: string,
    updateAvatarDto: UpdateAvatarDto,
    file?: Express.Multer.File,
  ) {
    const avatar = await this.avatarRepository.findByIdNotDeleted(id);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    let uploadResult: { secure_url: string; public_id: string } | undefined;
    const data: { name?: string; url?: string; publicId?: string } = {
      ...updateAvatarDto,
    };

    if (file) {
      if (avatar.publicId) {
        try {
          await this.uploadService.deleteImage(avatar.publicId);
        } catch (error) {
          this.logger.warn(
            'Failed to delete old image from Cloudinary:',
            error,
          );
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

    return this.avatarRepository.update(id, data);
  }

  async updateSystemAvatar(
    id: string,
    updateAvatarDto: UpdateAvatarDto,
    file?: Express.Multer.File,
  ) {
    const avatar = await this.avatarRepository.findByIdNotDeleted(id);
    if (!avatar) {
      throw new NotFoundException('System avatar not found');
    }

    if (!avatar.isSystemAvatar) {
      throw new BadRequestException('Cannot update non-system avatar');
    }

    return this.updateAvatar(id, updateAvatarDto, file);
  }

  async softDeleteAvatar(id: string) {
    const avatar = await this.avatarRepository.findByIdNotDeleted(id);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // For system avatars, check if they're in use
    if (avatar.isSystemAvatar) {
      const usersUsing = await this.avatarRepository.countUsersUsingAvatar(id);
      const kidsUsing = await this.avatarRepository.countKidsUsingAvatar(id);

      if (usersUsing > 0 || kidsUsing > 0) {
        throw new BadRequestException(
          'Cannot delete avatar that is currently in use',
        );
      }
    }

    return this.avatarRepository.softDelete(id);
  }

  async permanentDeleteAvatar(id: string) {
    const avatar = await this.avatarRepository.findById(id);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // For system avatars, check if they're in use
    if (avatar.isSystemAvatar) {
      const usersUsing = await this.avatarRepository.countUsersUsingAvatar(id);
      const kidsUsing = await this.avatarRepository.countKidsUsingAvatar(id);

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

    return this.avatarRepository.hardDelete(id);
  }

  async restoreAvatar(id: string) {
    const avatar = await this.avatarRepository.findById(id);

    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    if (!avatar.isDeleted) {
      return avatar; // Already not deleted
    }

    return this.avatarRepository.restore(id);
  }

  async assignAvatarToUser(userId: string, avatarId: string) {
    const user = await this.avatarRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.avatarRepository.findByIdNotDeleted(avatarId);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return this.avatarRepository.updateUserAvatar(userId, avatarId);
  }

  async assignAvatarToKid(kidId: string, avatarId: string) {
    const kid = await this.avatarRepository.findKidById(kidId);
    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const avatar = await this.avatarRepository.findByIdNotDeleted(avatarId);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return this.avatarRepository.updateKidAvatar(kidId, avatarId);
  }

  async uploadAndAssignUserAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.avatarRepository.findUserWithAvatar(userId);

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

    return this.avatarRepository.updateUserAvatar(userId, avatar.id);
  }

  async uploadAndAssignKidAvatar(kidId: string, file: Express.Multer.File) {
    const kid = await this.avatarRepository.findKidWithAvatar(kidId);

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

    return this.avatarRepository.updateKidAvatar(kidId, avatar.id);
  }
}
