export interface UserHistoryKid {
  id: string;
  name: string | null;
}

export interface UserActivityRow {
  id: string;
  action: string;
  createdAt: Date;
  kidId: string | null;
  /** Raw `ActivityLog.details` string; MUST be sanitised before exposure. */
  details: string | null;
}

export interface UserActivityPageParams {
  userId: string;
  /** Non-deleted kids of the user whose rows may be included. */
  kidIds: string[];
  /** Include the user's own rows (those with no kid attached). */
  includeUserOwn: boolean;
  action?: string;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface UserReadingRow {
  storyId: string;
  title: string;
  readerType: 'user' | 'kid';
  kidId: string | null;
  /** Percentage 0-100, exactly as stored. */
  progress: number;
  completed: boolean;
  totalTimeSpentSeconds: number;
  lastAccessed: Date;
}

export interface UserReadingFilter {
  userId: string;
  kidIds: string[];
  includeUser: boolean;
  start?: Date;
  end?: Date;
}

export interface UserReadingPageParams extends UserReadingFilter {
  skip: number;
  take: number;
}

export interface ReaderAggregate {
  storiesRead: number;
  storiesCompleted: number;
  totalTimeSpentSeconds: number;
  lastActiveAt: Date | null;
}

export interface UserReadingSummaryRaw {
  user: ReaderAggregate;
  kids: Array<ReaderAggregate & { kidId: string }>;
}

export interface IAdminUserHistoryRepository {
  /** The user if it exists and is not soft-deleted. */
  findActiveUser(userId: string): Promise<{ id: string } | null>;
  /** The user's non-soft-deleted kids. */
  findKids(userId: string): Promise<UserHistoryKid[]>;
  findActivityPage(
    params: UserActivityPageParams,
  ): Promise<{ rows: UserActivityRow[]; total: number }>;
  /** Titles of the given stories, excluding soft-deleted ones. */
  findStoryTitles(storyIds: string[]): Promise<Map<string, string>>;
  findReadingPage(
    params: UserReadingPageParams,
  ): Promise<{ rows: UserReadingRow[]; total: number }>;
  getReadingSummary(filter: UserReadingFilter): Promise<UserReadingSummaryRaw>;
}

export const ADMIN_USER_HISTORY_REPOSITORY = Symbol(
  'ADMIN_USER_HISTORY_REPOSITORY',
);
