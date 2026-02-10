import type { Kid, StoryBuddy, BuddyInteraction } from '@prisma/client';

// ==================== Types ====================
export interface KidWithBuddy extends Kid {
  storyBuddy: StoryBuddy | null;
}

// ==================== Repository Interface ====================
export interface IBuddySelectionRepository {
  // Find kid by id
  findKidById(kidId: string): Promise<Kid | null>;

  // Find kid with current buddy relation
  findKidWithBuddy(kidId: string): Promise<KidWithBuddy | null>;

  // Find story buddy by id
  findStoryBuddyById(buddyId: string): Promise<StoryBuddy | null>;

  // Update kid's buddy assignment with timestamp
  updateKidBuddy(
    kidId: string,
    buddyId: string,
    buddySelectedAt: Date,
  ): Promise<Kid>;

  // Create buddy interaction log
  createBuddyInteraction(
    kidId: string,
    buddyId: string,
    interactionType: string,
    context?: string | null,
  ): Promise<BuddyInteraction | void>;
}

export const BUDDY_SELECTION_REPOSITORY = Symbol('BUDDY_SELECTION_REPOSITORY');
