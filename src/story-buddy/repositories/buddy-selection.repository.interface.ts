import type { Kid, StoryBuddy, BuddyInteraction, Prisma } from '@prisma/client';

// ==================== Types ====================
export interface KidWithBuddy extends Kid {
  storyBuddy: StoryBuddy | null;
}

// Kid with a summary of its selected buddy
// (id/name/displayName/imageUrl/profileAvatarUrl/type)
export type KidWithSelectedBuddy = Prisma.KidGetPayload<{
  include: {
    storyBuddy: {
      select: {
        id: true;
        name: true;
        displayName: true;
        imageUrl: true;
        profileAvatarUrl: true;
        type: true;
      };
    };
  };
}>;

// Kid with a detailed view of its selected buddy
// (summary fields plus description/themeColor)
export type KidWithBuddyDetails = Prisma.KidGetPayload<{
  include: {
    storyBuddy: {
      select: {
        id: true;
        name: true;
        displayName: true;
        imageUrl: true;
        profileAvatarUrl: true;
        type: true;
        description: true;
        themeColor: true;
      };
    };
  };
}>;

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

  // Update kid's buddy assignment, returning the kid with a summary of the
  // newly selected buddy (id/name/displayName/imageUrl/profileAvatarUrl/type)
  updateKidBuddySelection(
    kidId: string,
    buddyId: string,
    buddySelectedAt: Date,
  ): Promise<KidWithSelectedBuddy>;

  // Find kid with a summary of its selected buddy
  findKidWithSelectedBuddy(
    kidId: string,
  ): Promise<KidWithSelectedBuddy | null>;

  // Find kid with a detailed view of its selected buddy
  findKidWithBuddyDetails(
    kidId: string,
  ): Promise<KidWithBuddyDetails | null>;

  // Create buddy interaction log
  createBuddyInteraction(
    kidId: string,
    buddyId: string,
    interactionType: string,
    context?: string | null,
  ): Promise<BuddyInteraction | void>;
}

export const BUDDY_SELECTION_REPOSITORY = Symbol('BUDDY_SELECTION_REPOSITORY');
