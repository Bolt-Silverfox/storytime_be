export interface IAdminAnalyticsRepository {
  // Lightweight DB connectivity probe (system health check)
  pingDatabase(): Promise<void>;

  // COUNT(DISTINCT storyId) of guest story-access logs (raw SQL / JSON extract)
  countUniqueGuestStories(guestStoryAccessedAction: string): Promise<number>;
}

export const ADMIN_ANALYTICS_REPOSITORY = Symbol('ADMIN_ANALYTICS_REPOSITORY');
