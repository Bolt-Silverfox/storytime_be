/**
 * Centralized cache keys to prevent drift between services
 */
export const CACHE_KEYS = {
  // Admin dashboard caches
  DASHBOARD_STATS: 'admin:dashboard:stats',
  STORY_STATS: 'admin:story:stats',
  CONTENT_BREAKDOWN: 'admin:content:breakdown',

  // Content caches
  CATEGORIES_ALL: 'categories:all',
  VOICES_ALL: 'voices:all',

  // Homepage caches
  TOP_PICKS_FROM_US: 'top-picks-from-us',
} as const;

/** Cache TTL values */
export const CACHE_TTL_MS = {
  DASHBOARD: 5 * 60 * 1000, // 5 minutes
  VOICES: 5 * 60 * 1000, // 5 minutes
  TOP_PICKS_FROM_US: 24 * 60 * 60 * 1000, // 24 hours
} as const;

/** Keys to invalidate when story content changes */
export const STORY_INVALIDATION_KEYS = [
  CACHE_KEYS.CATEGORIES_ALL,
  CACHE_KEYS.DASHBOARD_STATS,
  CACHE_KEYS.STORY_STATS,
  CACHE_KEYS.CONTENT_BREAKDOWN,
  CACHE_KEYS.TOP_PICKS_FROM_US,
] as const;
