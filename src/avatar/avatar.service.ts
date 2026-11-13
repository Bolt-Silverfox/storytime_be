import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
  Logger,
} from '@nestjs/common';
import { UploadService, UploadOwner } from '../upload/upload.service';
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

  private withoutCredentials<
    T extends { passwordHash: string | null; pinHash: string | null },
  >(user: T): Omit<T, 'passwordHash' | 'pinHash'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, pinHash, ...safe } = user;
    return safe;
  }

  private async handleCustomAvatarUpload(
    entityId: string,
    entityType: 'user' | 'kid',
    file: Express.Multer.File,
    entityName: string,
    owner?: UploadOwner,
  ) {
    let uploadResult;
    try {
      uploadResult = await this.uploadService.uploadImage(
        file,
        'avatars',
        owner,
      );
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw error;
      this.logger.error(
        `Failed to upload ${entityType} avatar to Cloudinary:`,
        error,
      );
      throw new BadRequestException('Failed to upload avatar image');
    }

    const avatarName = `${entityType}-avatar-${entityId}`;

    try {
      return await this.avatarRepository.replaceByName(avatarName, {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        isSystemAvatar: false,
      });
    } catch (error) {
      await this.uploadService
        .deleteImage(uploadResult.public_id)
        .catch((cleanupError: Error) =>
          this.logger.warn(
            `Failed to release avatar upload "${uploadResult.public_id}": ${cleanupError.message}`,
          ),
        );
      throw error;
    }
  }

  private async releaseReplacedAvatar(
    previous: {
      id: string;
      publicId: string | null;
      isSystemAvatar: boolean;
    } | null,
    replaced: { avatar: { id: string }; displacedPublicId: string | null },
  ) {
    try {
      if (replaced.displacedPublicId) {
        await this.uploadService.deleteImage(replaced.displacedPublicId);
      }
      if (
        previous &&
        !previous.isSystemAvatar &&
        previous.publicId &&
        previous.id !== replaced.avatar.id
      ) {
        const publicId = await this.avatarRepository.retireAvatarIfUnreferenced(
          previous.id,
        );
        if (publicId) await this.uploadService.deleteImage(publicId);
      }
    } catch (error) {
      this.logger.warn('Failed to delete old avatar:', error);
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
    owner?: UploadOwner,
  ) {
    let uploadResult: { secure_url: string; public_id: string } | undefined;

    if (file) {
      try {
        uploadResult = await this.uploadService.uploadImage(
          file,
          'avatars',
          owner,
        );
      } catch (error) {
        if (error instanceof PayloadTooLargeException) throw error;
        this.logger.error('Failed to upload image to Cloudinary:', error);
        throw new BadRequestException('Failed to upload image');
      }
    } else if (!createAvatarDto.url && isSystemAvatar) {
      // For system avatars, either file or URL is required
      throw new BadRequestException(
        'Either image file or URL is required for system avatars',
      );
    } else if (!isSystemAvatar) {
      // For custom avatars, file is required (file is already falsy in this branch)
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

    try {
      return await this.avatarRepository.create({
        name: avatarName,
        url: avatarUrl,
        publicId: uploadResult?.public_id || null,
        isSystemAvatar: isSystemAvatar,
        createdBy: createdByUserId,
      });
    } catch (error) {
      if (uploadResult) {
        await this.uploadService
          .deleteImage(uploadResult.public_id)
          .catch((cleanupError: Error) =>
            this.logger.warn(
              `Failed to release avatar upload "${uploadResult.public_id}": ${cleanupError.message}`,
            ),
          );
      }
      throw error;
    }
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

    return this.withoutCredentials(
      await this.avatarRepository.updateUserAvatar(userId, avatarId),
    );
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

  async uploadAndAssignUserAvatar(
    userId: string,
    file: Express.Multer.File,
    owner?: UploadOwner,
  ) {
    const user = await this.avatarRepository.findUserWithAvatar(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previous = user.avatarId
      ? await this.avatarRepository.findById(user.avatarId)
      : null;

    const replaced = await this.handleCustomAvatarUpload(
      userId,
      'user',
      file,
      user.name || user.email || 'Unknown User',
      owner,
    );

    const updated = await this.avatarRepository.updateUserAvatar(
      userId,
      replaced.avatar.id,
    );
    await this.releaseReplacedAvatar(previous, replaced);
    return this.withoutCredentials(updated);
  }

  async uploadAndAssignKidAvatar(
    kidId: string,
    file: Express.Multer.File,
    owner?: UploadOwner,
  ) {
    const kid = await this.avatarRepository.findKidWithAvatar(kidId);

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const previous = kid.avatarId
      ? await this.avatarRepository.findById(kid.avatarId)
      : null;

    const replaced = await this.handleCustomAvatarUpload(
      kidId,
      'kid',
      file,
      kid.name || 'Unknown Kid',
      owner,
    );

    const updated = await this.avatarRepository.updateKidAvatar(
      kidId,
      replaced.avatar.id,
    );
    await this.releaseReplacedAvatar(previous, replaced);
    return updated;
  }
}
