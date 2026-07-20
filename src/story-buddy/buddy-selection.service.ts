import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BUDDY_SELECTION_REPOSITORY,
  IBuddySelectionRepository,
} from './repositories';
import { BuddyMessagingService } from './buddy-messaging.service';

@Injectable()
export class BuddySelectionService {
  constructor(
    @Inject(BUDDY_SELECTION_REPOSITORY)
    private readonly buddySelectionRepository: IBuddySelectionRepository,
    private readonly buddyMessagingService: BuddyMessagingService,
  ) {}

  /**
   * Select a story buddy for a kid
   * @param kidId - The kid's ID
   * @param buddyId - The story buddy's ID
   * @param userId - The authenticated user's ID (parent)
   */
  async selectBuddyForKid(kidId: string, buddyId: string, userId: string) {
    // Verify kid exists and is not soft deleted
    const kid = await this.buddySelectionRepository.findKidById(kidId);

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // Verify parent ownership
    if (kid.parentId !== userId) {
      throw new ForbiddenException('You are not the parent of this kid');
    }

    // Verify buddy exists, is active, and not soft deleted
    const buddy =
      await this.buddySelectionRepository.findStoryBuddyById(buddyId);

    if (!buddy) {
      throw new NotFoundException('Story buddy not found');
    }

    if (!buddy.isActive) {
      throw new BadRequestException('This story buddy is not available');
    }

    // Update kid's buddy selection
    const updatedKid =
      await this.buddySelectionRepository.updateKidBuddySelection(
        kidId,
        buddyId,
        new Date(),
      );

    // Log the selection interaction
    await this.buddyMessagingService.logBuddyInteraction({
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
    const kid =
      await this.buddySelectionRepository.findKidWithSelectedBuddy(kidId);

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
    await this.buddyMessagingService.logBuddyInteraction({
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
   * Get kid's current buddy
   * @param kidId - The kid's ID
   * @param userId - The authenticated user's ID (parent)
   */
  async getKidCurrentBuddy(kidId: string, userId: string) {
    const kid =
      await this.buddySelectionRepository.findKidWithBuddyDetails(kidId);

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
}
