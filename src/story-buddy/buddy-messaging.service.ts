import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  BUDDY_SELECTION_REPOSITORY,
  IBuddySelectionRepository,
  BUDDY_MESSAGING_REPOSITORY,
  IBuddyMessagingRepository,
} from './repositories';

@Injectable()
export class BuddyMessagingService {
  private readonly logger = new Logger(BuddyMessagingService.name);

  constructor(
    @Inject(BUDDY_SELECTION_REPOSITORY)
    private readonly buddySelectionRepository: IBuddySelectionRepository,
    @Inject(BUDDY_MESSAGING_REPOSITORY)
    private readonly buddyMessagingRepository: IBuddyMessagingRepository,
  ) {}

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
    const kid =
      await this.buddySelectionRepository.findKidWithSelectedBuddy(kidId);

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
          const challenge =
            await this.buddyMessagingRepository.findChallengeContext(contextId);
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
          const story =
            await this.buddyMessagingRepository.findStoryContext(contextId);
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
   * Log buddy interaction - shared utility for buddy services
   * @param data - The interaction data to log
   */
  async logBuddyInteraction(data: {
    kidId: string;
    buddyId: string;
    interactionType: string;
    context?: string | null;
  }) {
    try {
      return await this.buddyMessagingRepository.createBuddyInteraction(
        data.kidId,
        data.buddyId,
        data.interactionType,
        data.context,
      );
    } catch (error) {
      this.logger.error('Failed to log buddy interaction:', error);
      // Don't throw error for logging failures
    }
  }
}
