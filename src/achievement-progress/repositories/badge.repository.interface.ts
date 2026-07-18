import type { Badge } from '@prisma/client';
import type { BadgeDefinition } from '../badge.constants';

// ==================== Repository Interface ====================
export interface IBadgeRepository {
  // Find all badges in the catalog
  findAll(): Promise<Badge[]>;

  // Find badges whose title is in the provided list
  findManyByTitles(titles: string[]): Promise<Badge[]>;

  // Count all badges in the catalog
  count(): Promise<number>;

  // Seed the badge catalog from definitions within a single transaction
  createBadgesInTransaction(catalog: BadgeDefinition[]): Promise<Badge[]>;
}

export const BADGE_REPOSITORY = Symbol('BADGE_REPOSITORY');
