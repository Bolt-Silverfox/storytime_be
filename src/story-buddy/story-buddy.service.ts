// src/story-buddy/story-buddy.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service'; // Only one import
import {
  CreateStoryBuddyDto,
  UpdateStoryBuddyDto,
  InteractionContext,
} from './story-buddy.dto';

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
  async getActiveBuddies(kidAge?: number) {
    const where: any = {
      isActive: true,
    };

    if (kidAge) {
      where.ageGroupMin = { lte: kidAge };
      where.ageGroupMax = { gte: kidAge };
    }

    return await this.prisma.storyBuddy.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get all story buddies including inactive (admin only)
   */
  async getAllBuddies() {
    return await this.prisma.storyBuddy.findMany({
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
      where: { id: buddyId },
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
    // Check if buddy with same name already exists
    const existingBuddy = await this.prisma.storyBuddy.findUnique({
      where: { name: createDto.name.toLowerCase() },
    });

    if (existingBuddy) {
      throw new ConflictException(
        `Story buddy with name "${createDto.name}" already exists`,
      );
    }

    let imageUrl = createDto.url;

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
      throw new BadRequestException('Either image file or URL is required');
    }

    // Validate personality JSON if provided
    if (createDto.personality) {
      try {
        JSON.parse(createDto.personality);
      } catch (error) {
        throw new BadRequestException('Personality must be valid JSON');
      }
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
        description: createDto.description,
        type: createDto.type,
        imageUrl,
        personality: createDto.personality,
        voiceType: createDto.voiceType,
        greetingMessages: createDto.greetingMessages || [],
        ageGroupMin: createDto.ageGroupMin ?? 3,
        ageGroupMax: createDto.ageGroupMax ?? 12,
        isActive: createDto.isActive ?? true,
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

    let imageUrl = updateDto.url;

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

    // Validate personality JSON if provided
    if (updateDto.personality) {
      try {
        JSON.parse(updateDto.personality);
      } catch (error) {
        throw new BadRequestException('Personality must be valid JSON');
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
        description: updateDto.description,
        type: updateDto.type,
        imageUrl: imageUrl || buddy.imageUrl,
        personality: updateDto.personality,
        voiceType: updateDto.voiceType,
        greetingMessages: updateDto.greetingMessages,
        ageGroupMin: updateDto.ageGroupMin,
        ageGroupMax: updateDto.ageGroupMax,
        isActive: updateDto.isActive,
      },
    });
  }

  /**
   * Delete story buddy (admin only)
   */
  async deleteBuddy(buddyId: string) {
    const buddy = await this.getBuddyById(buddyId);

    // Check if any kids are using this buddy
    const kidsCount = await this.prisma.kid.count({
      where: { storyBuddyId: buddyId },
    });

    if (kidsCount > 0) {
      throw new BadRequestException(
        `Cannot delete buddy "${buddy.displayName}" as it is currently assigned to ${kidsCount} kid(s)`,
      );
    }

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
  }

  /**
   * Select a story buddy for a kid
   */
  async selectBuddyForKid(kidId: string, buddyId: string) {
    // Verify kid exists
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify buddy exists and is active
    const buddy = await this.prisma.storyBuddy.findUnique({
      where: { id: buddyId },
    });

    if (!buddy) {
      throw new NotFoundException('Story buddy not found');
    }

    if (!buddy.isActive) {
      throw new BadRequestException('This story buddy is not available');
    }

    // Check if buddy is age-appropriate
    if (kid.ageRange) {
      const kidAge = this.extractAgeFromRange(kid.ageRange);
      if (kidAge && (kidAge < buddy.ageGroupMin || kidAge > buddy.ageGroupMax)) {
        throw new BadRequestException(
          `This buddy is recommended for ages ${buddy.ageGroupMin}-${buddy.ageGroupMax}`,
        );
      }
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
            type: true,
          },
        },
      },
    });

    // Log the selection interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId,
      interactionType: InteractionContext.BUDDY_SELECTED,
      message: `Selected ${buddy.displayName} as story buddy`,
    });

    return updatedKid;
  }

  /**
   * Get welcome message from kid's buddy
   */
  async getBuddyWelcome(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            greetingMessages: true,
            personality: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    if (!kid.storyBuddy) {
      throw new NotFoundException('No story buddy selected for this kid');
    }

    const buddy = kid.storyBuddy;
    const greetings = buddy.greetingMessages;

    // Select a random greeting or use default
    const message =
      greetings.length > 0
        ? greetings[Math.floor(Math.random() * greetings.length)]
        : `Hello ${kid.name || 'friend'}! I am ${buddy.displayName}. Ready to start reading together?`;

    // Personalize message with kid's name
    const personalizedMessage = message.replace(
      /\${kidName}/g,
      kid.name || 'friend',
    );

    // Log the interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId: buddy.id,
      interactionType: InteractionContext.GREETING,
      message: personalizedMessage,
    });

    return {
      buddy: {
        id: buddy.id,
        name: buddy.name,
        displayName: buddy.displayName,
        imageUrl: buddy.imageUrl,
      },
      message: personalizedMessage,
      imageUrl: buddy.imageUrl,
    };
  }

  /**
   * Get buddy message for specific context
   */
  async getBuddyMessage(
    kidId: string,
    context: InteractionContext,
    contextId?: string,
  ) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            personality: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    if (!kid.storyBuddy) {
      throw new NotFoundException('No story buddy selected for this kid');
    }

    const buddy = kid.storyBuddy;
    let message = '';
    let contextData = {};

    // Generate context-specific message
    switch (context) {
      case InteractionContext.BEDTIME:
        message = `Hey ${kid.name || 'friend'}, it's bedtime! Let me help you wind down with a wonderful story.`;
        contextData = { isBedtime: true };
        break;

      case InteractionContext.CHALLENGE:
        if (contextId) {
          const challenge = await this.prisma.dailyChallenge.findUnique({
            where: { id: contextId },
            select: { wordOfTheDay: true, meaning: true },
          });
          if (challenge) {
            message = `Well done ${kid.name || 'friend'}! Let's tackle today's word "${challenge.wordOfTheDay}" together!`;
            contextData = {
              challengeId: contextId,
              word: challenge.wordOfTheDay,
            };
          }
        } else {
          message = `Great job ${kid.name || 'friend'}! Ready for today's learning challenge?`;
        }
        break;

      case InteractionContext.STORY_START:
        if (contextId) {
          const story = await this.prisma.story.findUnique({
            where: { id: contextId },
            select: { title: true },
          });
          if (story) {
            message = `I'm excited to read "${story.title}" with you ${kid.name || 'friend'}! Let's make it a great adventure!`;
            contextData = { storyId: contextId, storyTitle: story.title };
          }
        } else {
          message = `I'm going to be your storytelling buddy ${kid.name || 'friend'}. Let's make it a great adventure!`;
        }
        break;

      case InteractionContext.STORY_COMPLETE:
        if (contextId) {
          const story = await this.prisma.story.findUnique({
            where: { id: contextId },
            select: { title: true },
          });
          if (story) {
            message = `Awesome job finishing "${story.title}" ${kid.name || 'friend'}! You're becoming such a great reader!`;
            contextData = { storyId: contextId, storyTitle: story.title };
          }
        } else {
          message = `Awesome job finishing that story ${kid.name || 'friend'}! You're becoming such a great reader!`;
        }
        break;

      case InteractionContext.SCREEN_TIME_WARNING:
        message = `${
          kid.name || 'Friend'
        }, you've been reading for a while. Time to take a little break and rest your eyes!`;
        contextData = { warningType: 'screen_time' };
        break;

      case InteractionContext.GREETING:
        message = `Hello ${kid.name || 'friend'}! Good to see you again!`;
        break;

      default:
        message = `Hi ${kid.name || 'friend'}! Ready for more fun?`;
    }

    // Log the interaction
    await this.logBuddyInteraction({
      kidId,
      buddyId: buddy.id,
      interactionType: context,
      context: contextId,
      message,
    });

    return {
      buddy: {
        id: buddy.id,
        name: buddy.name,
        displayName: buddy.displayName,
        imageUrl: buddy.imageUrl,
      },
      message,
      imageUrl: buddy.imageUrl,
      context,
      contextData,
    };
  }

  /**
   * Get buddy interaction history for a kid
   */
  async getBuddyInteractionHistory(kidId: string, limit = 50) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    return await this.prisma.buddyInteraction.findMany({
      where: { kidId },
      include: {
        buddy: {
          select: {
            id: true,
            displayName: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100), // Limit to 100 max for safety
    });
  }

  /**
   * Change kid's story buddy
   */
  async changeBuddy(kidId: string, newBuddyId: string) {
    return await this.selectBuddyForKid(kidId, newBuddyId);
  }

  /**
   * Get kid's current buddy
   */
  async getKidCurrentBuddy(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        storyBuddy: {
          select: {
            id: true,
            name: true,
            displayName: true,
            imageUrl: true,
            type: true,
            description: true,
            voiceType: true,
          },
        },
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
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
      include: {
        _count: {
          select: {
            kids: true,
            buddyInteractions: true,
          },
        },
      },
    });

    const totalInteractions = await this.prisma.buddyInteraction.count();
    const totalKidsWithBuddies = await this.prisma.kid.count({
      where: { storyBuddyId: { not: null } },
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
      // Cloudinary URLs typically have the format:
      // https://res.cloudinary.com/<cloud_name>/image/upload/<version>/<public_id>.<format>
      const urlParts = imageUrl.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1 && uploadIndex + 2 < urlParts.length) {
        // Get everything after the version part
        const publicIdWithVersion = urlParts.slice(uploadIndex + 2).join('/');
        // Remove file extension
        return publicIdWithVersion.split('.')[0];
      }
      return null;
    } catch (error) {
      this.logger.warn('Failed to extract public ID from URL:', imageUrl);
      return null;
    }
  }

  /**
   * Delete story buddy image from Cloudinary
   */
  private async deleteStoryBuddyImage(imageUrl: string): Promise<void> {
    if (!this.isCloudinaryImage(imageUrl)) {
      return; // Only delete Cloudinary images
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
   * Extract age from age range string (e.g., "6-8" -> 7)
   */
  private extractAgeFromRange(ageRange: string): number | null {
    try {
      const ages = ageRange.split('-').map((age) => parseInt(age.trim()));
      if (ages.length === 2 && !isNaN(ages[0]) && !isNaN(ages[1])) {
        return Math.floor((ages[0] + ages[1]) / 2);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Log buddy interaction (private helper)
   */
  private async logBuddyInteraction(data: {
    kidId: string;
    buddyId: string;
    interactionType: InteractionContext | string;
    context?: string | null;
    message: string | null;
  }) {
    try {
      return await this.prisma.buddyInteraction.create({
        data: {
          kidId: data.kidId,
          buddyId: data.buddyId,
          interactionType: data.interactionType,
          context: data.context || null,
          message: data.message,
        },
      });
    } catch (error) {
      this.logger.error('Failed to log buddy interaction:', error);
      // Don't throw error for logging failures to avoid breaking main functionality
    }
  }
}