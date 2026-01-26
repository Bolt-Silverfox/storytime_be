/**
 * Shared type definitions for the Storytime API
 * Import from '@/shared/types'
 */

// Re-export auth types for convenience
export { JwtPayload, AuthenticatedRequest } from '../guards/auth.guard';

/**
 * Google OAuth profile returned from passport strategy
 */
export interface GoogleOAuthProfile {
  email: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
  emailVerified?: boolean;
  provider: 'google';
  providerId: string;
}

/**
 * Request with Google OAuth user attached by passport
 */
export interface GoogleOAuthRequest extends Request {
  user: GoogleOAuthProfile;
}

/**
 * Generic pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Generic paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Badge metadata for achievement tracking
 */
export interface BadgeMetadata {
  kidId?: string;
  storyId?: string;
  categoryId?: string;
  themeId?: string;
  count?: number;
  [key: string]: string | number | boolean | undefined;
}
