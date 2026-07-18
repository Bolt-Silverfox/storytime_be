import type { BuddyInteraction, Prisma } from '@prisma/client';

// ==================== Types ====================
// Word/meaning of a daily challenge used to build buddy message context
export type ChallengeContext = Prisma.DailyChallengeGetPayload<{
  select: { wordOfTheDay: true; meaning: true };
}>;

// Title of a story used to build buddy message context
export type StoryContext = Prisma.StoryGetPayload<{
  select: { title: true };
}>;

// ==================== Repository Interface ====================
export interface IBuddyMessagingRepository {
  // Find a non-deleted daily challenge's word/meaning for message context
  findChallengeContext(challengeId: string): Promise<ChallengeContext | null>;

  // Find a non-deleted story's title for message context
  findStoryContext(storyId: string): Promise<StoryContext | null>;

  // Create a buddy interaction log entry
  createBuddyInteraction(
    kidId: string,
    buddyId: string,
    interactionType: string,
    context?: string | null,
  ): Promise<BuddyInteraction>;
}

export const BUDDY_MESSAGING_REPOSITORY = Symbol('BUDDY_MESSAGING_REPOSITORY');
