import { StoryBuddy, Prisma } from '@prisma/client';

export type StoryBuddyWithCounts = StoryBuddy & {
    _count?: {
        kids: number;
        buddyInteractions: number;
    };
};

export interface IStoryBuddyRepository {
    findActiveBuddies(): Promise<StoryBuddy[]>;

    findAllBuddies(): Promise<StoryBuddyWithCounts[]>;

    findBuddyById(id: string, includeDeleted?: boolean): Promise<StoryBuddyWithCounts | null>;

    findBuddyByName(name: string, includeDeleted?: boolean): Promise<StoryBuddy | null>;

    createBuddy(data: Prisma.StoryBuddyCreateInput): Promise<StoryBuddy>;

    updateBuddy(id: string, data: Prisma.StoryBuddyUpdateInput): Promise<StoryBuddy>;

    deleteBuddy(id: string): Promise<StoryBuddy>; // Permanent

    // Stats
    countBuddies(where?: Prisma.StoryBuddyWhereInput): Promise<number>;
    countInteractions(where?: Prisma.BuddyInteractionWhereInput): Promise<number>;
    countKidsWithBuddies(where?: Prisma.KidWhereInput): Promise<number>;

    // Interactions
    // Interactions
    deleteInteractionsByBuddyId(buddyId: string): Promise<Prisma.BatchPayload>;

    getBuddyStats(): Promise<{
        totalBuddies: number;
        activeBuddies: number;
        totalInteractions: number;
        kidsWithBuddies: number;
    }>;
}

export const STORY_BUDDY_REPOSITORY = Symbol('STORY_BUDDY_REPOSITORY');
