import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import {
  CreateStoryBuddyDto,
  UpdateStoryBuddyDto,
} from './dto/story-buddy.dto';

@Injectable()
export class StoryBuddyService {
  private readonly logger = new Logger(StoryBuddyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Get all active story buddies (public access)
   */
  async getActiveBuddies() {
    return await this.prisma.storyBuddy.findMany({
      where: {
        isActive: true,
        isDeleted: false, // EXCLUDE SOFT DELETED BUDDIES
      },
      orderBy: { createdAt: 'asc' },
    });
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
    return await this.prisma.storyBuddy.create({
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

    return await this.prisma.storyBuddy.update({
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

      return await this.prisma.storyBuddy.delete({
        where: { id: buddyId },
      });
    } else {
      // Soft delete
      return await this.prisma.storyBuddy.update({
        where: { id: buddyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
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

    return await this.prisma.storyBuddy.update({
      where: { id: buddyId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  /**
   * Select a story buddy for a kid
   * @param kidId - The kid's ID
   * @param buddyId - The story buddy's ID
   * @param userId - The authenticated user's ID (parent)
   */
  async selectBuddyForKid(kidId: string, buddyId: string, userId: string) {
    // Verify kid exists and is not soft deleted
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT SELECT BUDDY FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify parent ownership
    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    // Verify buddy exists, is active, and not soft deleted
    const buddy = await this.prisma.storyBuddy.findUnique({
      where: {
        id: buddyId,
        isDeleted: false, // CANNOT SELECT SOFT DELETED BUDDIES
      },
    });

    if (!buddy) {
      throw new NotFoundException('Story buddy not found');
    }

    if (!buddy.isActive) {
      throw new BadRequestException('This story buddy is not available');
    }

    // Update kid's buddy selection
    const updatedKid = await this.prisma.kid.update({
      where: { id: kidId },
      data: {
        storyBuddyId: buddyId,
        buddySelectedAt: new Date(),
      },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            profileAvatarUrl: true,
            type: true,
          },
        },
      },
    });

    // Log the selection interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId,
      interactionType: 'buddy_selected',
    });

    return {
      success: true,
      message: `Successfully selected ${buddy.displayName} as story buddy`,
      buddy: updatedKid.storyBuddy,
    };
  }

  /**
   * Get welcome message from kid's buddy
   * @param kidId - The kid's ID
   * @param userId - The authenticated user's ID (parent)
   */
  async getBuddyWelcome(kidId: string, userId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET WELCOME FOR SOFT DELETED KIDS
      },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            profileAvatarUrl: true,
            type: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify parent ownership
    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    if (!kid.storyBuddy) {
      throw new NotFoundException('No story buddy selected for this kid');
    }

    const buddy = kid.storyBuddy;

    // Log the interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId: buddy.id,
      interactionType: 'greeting',
    });

    return {
      buddy: {
        id: buddy.id,
        name: buddy.name,
        displayName: buddy.displayName,
        imageUrl: buddy.imageUrl,
        profileAvatarUrl: buddy.profileAvatarUrl,
      },
      message: `Hi ${kid.name}! I'm ${buddy.displayName}. I'm so excited to read stories with you!`,
      imageUrl: buddy.imageUrl,
      profileAvatarUrl: buddy.profileAvatarUrl,
    };
  }

  /**
   * Get buddy message for specific context
   * @param kidId - The kid's ID
   * @param context - The message context (e.g., 'greeting', 'challenge')
   * @param contextId - Optional context ID (e.g., story ID, challenge ID)
   * @param message - Optional custom message from frontend
   * @param userId - The authenticated user's ID (parent)
   */
  async getBuddyMessage(
    kidId: string,
    context: string,
    contextId?: string,
    message?: string,
    userId?: string,
  ) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET MESSAGE FOR SOFT DELETED KIDS
      },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            profileAvatarUrl: true,
            type: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify parent ownership
    if (userId && kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    if (!kid.storyBuddy) {
      throw new NotFoundException('No story buddy selected for this kid');
    }

    const buddy = kid.storyBuddy;
    let contextData = {};

    // Prepare context data if needed
    if (contextId) {
      switch (context) {
        case 'challenge': {
          const challenge = await this.prisma.dailyChallenge.findUnique({
            where: {
              id: contextId,
              isDeleted: false, // ONLY USE NON-DELETED CHALLENGES
            },
            select: { wordOfTheDay: true, meaning: true },
          });
          if (challenge) {
            contextData = {
              challengeId: contextId,
              word: challenge.wordOfTheDay,
            };
          }
          break;
        }

        case 'story_start':
        case 'story_complete': {
          const story = await this.prisma.story.findUnique({
            where: {
              id: contextId,
              isDeleted: false, // ONLY USE NON-DELETED STORIES
            },
            select: { title: true },
          });
          if (story) {
            contextData = {
              storyId: contextId,
              storyTitle: story.title,
            };
          }
          break;
        }
      }
    }

    // Log the interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId: buddy.id,
      interactionType: context,
    });

    // Generate dynamic message if not provided
    let finalMessage = message || '';

    if (!finalMessage) {
      switch (context) {
        case 'greeting':
          finalMessage = `Hi ${kid.name}! Ready for a story?`;
          break;
        case 'challenge':
          finalMessage = `Hey ${kid.name}! Let's learn a new word today!`;
          break;
        case 'story_start':
          finalMessage = `Enjoy the story, ${kid.name}!`;
          break;
        case 'story_complete':
          finalMessage = `Great reading, ${kid.name}! You did it!`;
          break;
        default:
          finalMessage = `Hello ${kid.name}!`;
      }
    }

    return {
      buddy: {
        id: buddy.id,
        name: buddy.name,
        displayName: buddy.displayName,
        imageUrl: buddy.imageUrl,
        profileAvatarUrl: buddy.profileAvatarUrl,
      },
      message: finalMessage, // Return generated or frontend-provided message
      imageUrl: buddy.imageUrl,
      profileAvatarUrl: buddy.profileAvatarUrl,
      context,
      contextData,
    };
  }

  /**
   * Get kid's current buddy
   * @param kidId - The kid's ID
   * @param userId - The authenticated user's ID (parent)
   */
  async getKidCurrentBuddy(kidId: string, userId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET BUDDY FOR SOFT DELETED KIDS
      },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            profileAvatarUrl: true,
            type: true,
            description: true,
            themeColor: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify parent ownership
    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    if (!kid.storyBuddy) {
      throw new NotFoundException('No story buddy selected for this kid');
    }

    return kid.storyBuddy;
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
    try {
      const { hostname } = new URL(imageUrl);
      return (
        hostname === 'res.cloudinary.com' || hostname.endsWith('.cloudinary.com')
      );
    } catch {
      return false;
    }
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

  /**
   * Log buddy interaction (private helper) - without saving messages
   */
  private async logBuddyInteraction(data: {
    kidId: string;
    buddyId: string;
    interactionType: string;
    context?: string | null;
  }) {
    try {
      return await this.prisma.buddyInteraction.create({
        data: {
          kidId: data.kidId,
          buddyId: data.buddyId,
          interactionType: data.interactionType,
          context: data.context || null,
          message: null, // No longer saving messages
        },
      });
    } catch (error) {
      this.logger.error('Failed to log buddy interaction:', error);
      // Don't throw error for logging failures
    }
  }
}
