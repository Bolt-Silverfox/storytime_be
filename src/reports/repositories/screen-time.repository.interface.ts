import type { ScreenTimeSession, Kid, User, Profile } from '@prisma/client';

// ==================== Types ====================
export interface KidWithParentProfile extends Kid {
  parent: User & {
    profile: Profile | null;
  };
}

// ==================== Repository Interface ====================
export interface IScreenTimeRepository {
  // Find active session for a kid
  findActiveSession(kidId: string): Promise<ScreenTimeSession | null>;

  // Create a new screen time session
  createSession(kidId: string, date: Date): Promise<ScreenTimeSession>;

  // Find a session by id
  findSessionById(id: string): Promise<ScreenTimeSession | null>;

  // Update a session (end it)
  updateSession(
    id: string,
    data: { endTime: Date; duration: number },
  ): Promise<ScreenTimeSession>;

  // Find sessions for a date range
  findSessionsByDateRange(
    kidId: string,
    startDate: Date,
    endDate: Date,
    includeActive?: boolean,
  ): Promise<ScreenTimeSession[]>;

  // Find kid with parent profile
  findKidWithParentProfile(kidId: string): Promise<KidWithParentProfile | null>;

  // Find kid by id
  findKidById(kidId: string): Promise<Kid | null>;
}

export const SCREEN_TIME_REPOSITORY = Symbol('SCREEN_TIME_REPOSITORY');
