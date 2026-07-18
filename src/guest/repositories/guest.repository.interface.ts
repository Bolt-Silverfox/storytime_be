import type { Prisma } from '@prisma/client';

// ==================== Select Shapes / Types ====================

// Story fields projected for guest progress/history responses. Kept as a
// single shared constant so every query stays byte-for-byte identical.
export const GUEST_STORY_DETAIL_SELECT = {
  id: true,
  title: true,
  description: true,
  coverImageUrl: true,
  ageMax: true,
  ageMin: true,
  durationSeconds: true,
  createdAt: true,
  updatedAt: true,
  categories: {
    select: {
      id: true,
      name: true,
      image: true,
      description: true,
    },
  },
} satisfies Prisma.StorySelect;

export type GuestStoryDetail = Prisma.StoryGetPayload<{
  select: typeof GUEST_STORY_DETAIL_SELECT;
}>;

export type GuestUserProgressRow = Prisma.UserStoryProgressGetPayload<{
  select: { progress: true; lastAccessed: true; completed: true };
}>;

export type GuestUserHistoryRow = Prisma.UserStoryProgressGetPayload<{
  select: {
    storyId: true;
    progress: true;
    completed: true;
    lastAccessed: true;
    story: { select: typeof GUEST_STORY_DETAIL_SELECT };
  };
}>;

// ==================== Repository Interface ====================
// All persistent DB access performed on behalf of the guest endpoints and the
// guest activity listener. Every query mirrors the original inline Prisma call
// byte-for-byte to preserve responses exactly.
export interface IGuestRepository {
  // Upsert an authenticated user's reading progress for a story. Completion is
  // monotonic: only ever set to true, never downgraded.
  upsertUserStoryProgress(
    userId: string,
    storyId: string,
    progress: number,
    markCompleted: boolean,
  ): Promise<void>;

  // Find an authenticated user's active (non-deleted) progress for a story.
  findUserStoryProgress(
    userId: string,
    storyId: string,
  ): Promise<GuestUserProgressRow | null>;

  // Find a single non-deleted story's detail projection.
  findStoryDetail(storyId: string): Promise<GuestStoryDetail | null>;

  // Find an authenticated user's full reading history, newest first.
  findUserReadingHistory(userId: string): Promise<GuestUserHistoryRow[]>;

  // Find detail projections for a set of non-deleted stories.
  findStoryDetailsByIds(storyIds: string[]): Promise<GuestStoryDetail[]>;

  // Record a guest activity log entry (no associated user).
  createGuestActivityLog(data: {
    action: string;
    status: string;
    details: string;
  }): Promise<void>;
}

export const GUEST_REPOSITORY = Symbol('GUEST_REPOSITORY');
