import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { BuddySelectionService } from './buddy-selection.service';
import { BuddyMessagingService } from './buddy-messaging.service';
import {
  CreateStoryBuddyDto,
  UpdateStoryBuddyDto,
} from './dto/story-buddy.dto';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '../shared/constants/cache-keys.constants';

@Injectable()
export class StoryBuddyService {
  private readonly logger = new Logger(StoryBuddyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly buddySelectionService: BuddySelectionService,
    private readonly buddyMessagingService: BuddyMessagingService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Invalidate story buddies cache
   */
  private async invalidateBuddiesCache(): Promise<void> {
    await this.cacheManager.del(CACHE_KEYS.STORY_BUDDIES_ALL);
  }

  /**
   * Get all active story buddies (public access)
   * Uses caching for improved performance (1 hour TTL)
   */
  async getActiveBuddies() {
    // Check cache first
    const cached = await this.cacheManager.get(CACHE_KEYS.STORY_BUDDIES_ALL);
    if (cached) {
      return cached;
    }

    const buddies = await this.prisma.storyBuddy.findMany({
      where: {
        isActive: true,
        isDeleted: false, // EXCLUDE SOFT DELETED BUDDIES
      },
      orderBy: { createdAt: 'asc' },
    });

    // Cache for 1 hour (static content)
    await this.cacheManager.set(
      CACHE_KEYS.STORY_BUDDIES_ALL,
      buddies,
      CACHE_TTL_MS.STATIC_CONTENT,
    );

    return buddies;
  }

  /**
   * Get all story buddies including inactive (admin only)
   */
  async getAllBuddies() {
    return await this.prisma.storyBuddy.findMany({
      where: {
        isDeleted: false, // EXCLUDE SOFT DELETED BUDDIES
      },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });
  }

  /**
   * Get single story buddy by ID
   */
  async getBuddyById(buddyId: string) {
    const buddy = await this.prisma.storyBuddy.findUnique({
      where: {
        id: buddyId,
        isDeleted: false, // EXCLUDE SOFT DELETED BUDDIES
      },
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });

    if (!buddy) {
      throw new NotFoundException('Story buddy not found');
    }

    return buddy;
  }

  /**
   * Create a new story buddy (admin only)
   */
  async createBuddy(
    createDto: CreateStoryBuddyDto,
    file?: Express.Multer.File,
  ) {
    // Check if buddy with same name already exists (including soft deleted)
    const existingBuddy = await this.prisma.storyBuddy.findFirst({
      where: {
        name: createDto.name.toLowerCase(),
        isDeleted: false, // ONLY CHECK NON-DELETED BUDDIES
      },
    });

    if (existingBuddy) {
      throw new ConflictException(
        `Story buddy with name "${createDto.name}" already exists`,
      );
    }

    let imageUrl = createDto.imageUrl;

    // Handle file upload
    if (file) {
      try {
        const uploadResult = await this.uploadService.uploadImage(
          file,
          'story-buddies',
        );
        imageUrl = uploadResult.secure_url;
        this.logger.log(`Story buddy image uploaded: ${imageUrl}`);
      } catch (error) {
        this.logger.error('Failed to upload story buddy image:', error);
        throw new BadRequestException('Failed to upload image file');
      }
    }

    if (!imageUrl) {
      throw new BadRequestException(
        'Either image file or imageUrl is required',
      );
    }

    // Validate age ranges
    if (createDto.ageGroupMin && createDto.ageGroupMax) {
      if (createDto.ageGroupMin > createDto.ageGroupMax) {
        throw new BadRequestException(
          'Minimum age cannot be greater than maximum age',
        );
      }
    }

    // Create the buddy
    const buddy = await this.prisma.storyBuddy.create({
      data: {
        name: createDto.name.toLowerCase(),
        displayName: createDto.displayName,
        type: createDto.type,
        description: createDto.description,
        imageUrl,
        profileAvatarUrl: createDto.profileAvatarUrl,
        isActive: createDto.isActive ?? true,
        themeColor: createDto.themeColor,
        ageGroupMin: createDto.ageGroupMin ?? 3,
        ageGroupMax: createDto.ageGroupMax ?? 12,
      },
    });

    // Invalidate cache
    await this.invalidateBuddiesCache();

    return buddy;
  }

  /**
   * Update story buddy (admin only)
   */
  async updateBuddy(
    buddyId: string,
    updateDto: UpdateStoryBuddyDto,
    file?: Express.Multer.File,
  ) {
    const buddy = await this.getBuddyById(buddyId);

    let imageUrl = updateDto.imageUrl;

    // Handle file upload
    if (file) {
      try {
        // Delete old image if it was uploaded (contains cloudinary signature)
        if (buddy.imageUrl && this.isCloudinaryImage(buddy.imageUrl)) {
          try {
            await this.deleteStoryBuddyImage(buddy.imageUrl);
          } catch (error) {
            this.logger.warn('Failed to delete old story buddy image:', error);
          }
        }

        const uploadResult = await this.uploadService.uploadImage(
          file,
          'story-buddies',
        );
        imageUrl = uploadResult.secure_url;
        this.logger.log(`Story buddy image updated: ${imageUrl}`);
      } catch (error) {
        this.logger.error('Failed to upload new story buddy image:', error);
        throw new BadRequestException('Failed to upload image file');
      }
    }

    // Validate age ranges
    if (updateDto.ageGroupMin && updateDto.ageGroupMax) {
      if (updateDto.ageGroupMin > updateDto.ageGroupMax) {
        throw new BadRequestException(
          'Minimum age cannot be greater than maximum age',
        );
      }
    }

    const updatedBuddy = await this.prisma.storyBuddy.update({
      where: { id: buddyId },
      data: {
        displayName: updateDto.displayName,
        type: updateDto.type,
        description: updateDto.description,
        imageUrl: imageUrl || buddy.imageUrl,
        profileAvatarUrl: updateDto.profileAvatarUrl,
        isActive: updateDto.isActive,
        themeColor: updateDto.themeColor,
        ageGroupMin: updateDto.ageGroupMin,
        ageGroupMax: updateDto.ageGroupMax,
      },
    });

    // Invalidate cache
    await this.invalidateBuddiesCache();

    return updatedBuddy;
  }

  /**
   * Delete story buddy (admin only)
   * @param buddyId Story buddy ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteBuddy(buddyId: string, permanent: boolean = false) {
    const buddy = await this.getBuddyById(buddyId);

    // Check if any kids are using this buddy
    const kidsCount = await this.prisma.kid.count({
      where: {
        storyBuddyId: buddyId,
        isDeleted: false, // ONLY COUNT NON-DELETED KIDS
      },
    });

    if (kidsCount > 0) {
      throw new BadRequestException(
        `Cannot delete buddy "${buddy.displayName}" as it is currently assigned to ${kidsCount} kid(s)`,
      );
    }

    if (permanent) {
      // Delete associated image if it was uploaded
      if (buddy.imageUrl && this.isCloudinaryImage(buddy.imageUrl)) {
        try {
          await this.deleteStoryBuddyImage(buddy.imageUrl);
        } catch (error) {
          this.logger.warn('Failed to delete story buddy image:', error);
        }
      }

      // Delete all associated interactions
      await this.prisma.buddyInteraction.deleteMany({
        where: { buddyId },
      });

      const deletedBuddy = await this.prisma.storyBuddy.delete({
        where: { id: buddyId },
      });

      // Invalidate cache
      await this.invalidateBuddiesCache();

      return deletedBuddy;
    } else {
      // Soft delete
      const softDeletedBuddy = await this.prisma.storyBuddy.update({
        where: { id: buddyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      // Invalidate cache
      await this.invalidateBuddiesCache();

      return softDeletedBuddy;
    }
  }

  /**
   * Restore a soft deleted story buddy (admin only)
   * @param buddyId Story buddy ID
   */
  async undoDeleteBuddy(buddyId: string) {
    const buddy = await this.prisma.storyBuddy.findUnique({
      where: { id: buddyId },
    });

    if (!buddy) {
      throw new NotFoundException('Story buddy not found');
    }

    if (!buddy.isDeleted) {
      throw new BadRequestException('Story buddy is not deleted');
    }

    const restoredBuddy = await this.prisma.storyBuddy.update({
      where: { id: buddyId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });

    // Invalidate cache
    await this.invalidateBuddiesCache();

    return restoredBuddy;
  }

  /**
   * Select a story buddy for a kid
   * Delegates to BuddySelectionService
   */
  async selectBuddyForKid(kidId: string, buddyId: string, userId: string) {
    return this.buddySelectionService.selectBuddyForKid(kidId, buddyId, userId);
  }

  /**
   * Get welcome message from kid's buddy
   * Delegates to BuddySelectionService
   */
  async getBuddyWelcome(kidId: string, userId: string) {
    return this.buddySelectionService.getBuddyWelcome(kidId, userId);
  }

  /**
   * Get buddy message for specific context
   * Delegates to BuddyMessagingService
   */
  async getBuddyMessage(
    kidId: string,
    context: string,
    contextId?: string,
    message?: string,
    userId?: string,
  ) {
    return this.buddyMessagingService.getBuddyMessage(
      kidId,
      context,
      contextId,
      message,
      userId,
    );
  }

  /**
   * Get kid's current buddy
   * Delegates to BuddySelectionService
   */
  async getKidCurrentBuddy(kidId: string, userId: string) {
    return this.buddySelectionService.getKidCurrentBuddy(kidId, userId);
  }

  /**
   * Get buddy statistics (for admin dashboard)
   */
  async getBuddyStats() {
    const buddies = await this.prisma.storyBuddy.findMany({
      where: {
        isDeleted: false, // ONLY COUNT NON-DELETED BUDDIES
      },
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });

    const totalInteractions = await this.prisma.buddyInteraction.count({
      where: {
        isDeleted: false, // ONLY COUNT NON-DELETED INTERACTIONS
      },
    });

    const totalKidsWithBuddies = await this.prisma.kid.count({
      where: {
        storyBuddyId: { not: null },
        isDeleted: false, // ONLY COUNT NON-DELETED KIDS
      },
    });

    return {
      totalBuddies: buddies.length,
      totalInteractions,
      totalKidsWithBuddies,
      buddies: buddies.map((buddy) => ({
        id: buddy.id,
        name: buddy.name,
        displayName: buddy.displayName,
        isActive: buddy.isActive,
        kidCount: buddy._count.kids,
        interactionCount: buddy._count.buddyInteractions,
      })),
    };
  }

  /**
   * Check if image is from Cloudinary (contains cloudinary signature)
   */
  private isCloudinaryImage(imageUrl: string): boolean {
    return (
      imageUrl.includes('res.cloudinary.com') ||
      imageUrl.includes('cloudinary.com')
    );
  }

  /**
   * Extract public ID from Cloudinary URL for deletion
   */
  private extractPublicIdFromUrl(imageUrl: string): string | null {
    try {
      const urlParts = imageUrl.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
        const publicIdWithVersion = urlParts.slice(uploadIndex + 2).join('/');
        return publicIdWithVersion.split('.')[0];
      }
      return null;
    } catch {
      this.logger.warn('Failed to extract public ID from URL:', imageUrl);
      return null;
    }
  }

  /**
   * Delete story buddy image from Cloudinary
   */
  private async deleteStoryBuddyImage(imageUrl: string): Promise<void> {
    if (!this.isCloudinaryImage(imageUrl)) {
      return;
    }

    const publicId = this.extractPublicIdFromUrl(imageUrl);
    if (!publicId) {
      this.logger.warn('Could not extract public ID from image URL:', imageUrl);
      return;
    }

    try {
      await this.uploadService.deleteImage(publicId);
      this.logger.log(`Successfully deleted story buddy image: ${publicId}`);
    } catch (error) {
      this.logger.error('Failed to delete story buddy image:', error);
      throw error;
    }
  }
}
