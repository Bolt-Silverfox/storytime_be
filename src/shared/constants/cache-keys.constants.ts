/**
 * Centralized cache keys to prevent drift between services
 */
export const CACHE_KEYS = {
  // Admin dashboard caches
  DASHBOARD_STATS: 'admin:dashboard:stats',
  STORY_STATS: 'admin:story:stats',
  CONTENT_BREAKDOWN: 'admin:content:breakdown',
  USER_GROWTH: (params: string) => `admin:user:growth:${params}`,
  SUBSCRIPTION_ANALYTICS: (params: string) =>
    `admin:subscription:analytics:${params}`,
  REVENUE_ANALYTICS: (params: string) => `admin:revenue:analytics:${params}`,
  AI_CREDIT_ANALYTICS: 'admin:ai-credit:analytics',
  USER_GROWTH_MONTHLY: 'admin:user-growth-monthly',

  // Content caches (static data)
  CATEGORIES_ALL: 'categories:all',
  THEMES_ALL: 'themes:all',
  VOICES_ALL: 'voices:all',
  STORY_BUDDIES_ALL: 'story-buddies:all',
  SEASONS_ALL: 'seasons:all',

  // Homepage caches
  TOP_PICKS_FROM_US: 'top-picks-from-us',

  // User-specific caches (dynamic keys with userId/kidId)
  USER_PREFERENCES: (userId: string) => `user:${userId}:preferences`,
  KID_PROFILE: (kidId: string) => `kid:${kidId}:profile`,
  USER_KIDS: (userId: string) => `user:${userId}:kids`,

  // Subscription caches
  SUBSCRIPTION_STATUS: (userId: string) => `subscription:status:${userId}`,

  // Progress/Achievement caches
  PROGRESS_HOME: (userId: string) => `progress:home:${userId}`,
  PROGRESS_OVERVIEW: (userId: string) => `progress:overview:${userId}`,
} as const;

/** Cache TTL values */
export const CACHE_TTL_MS = {
  DASHBOARD: 5 * 60 * 1000, // 5 minutes
  STATIC_CONTENT: 60 * 60 * 1000, // 1 hour for categories, themes, buddies
  VOICES: 30 * 60 * 1000, // 30 minutes
  TOP_PICKS_FROM_US: 24 * 60 * 60 * 1000, // 24 hours
  USER_DATA: 5 * 60 * 1000, // 5 minutes for user preferences and kid profiles
} as const;

/** Keys to invalidate when story content changes */
export const STORY_INVALIDATION_KEYS = [
  CACHE_KEYS.CATEGORIES_ALL,
  CACHE_KEYS.THEMES_ALL,
  CACHE_KEYS.SEASONS_ALL,
  CACHE_KEYS.DASHBOARD_STATS,
  CACHE_KEYS.STORY_STATS,
  CACHE_KEYS.CONTENT_BREAKDOWN,
  CACHE_KEYS.TOP_PICKS_FROM_US,
] as const;
