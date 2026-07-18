// ==================== Repository Interface ====================
export interface IFavoriteRepository {
  // Count favorites for a kid
  countByKid(kidId: string): Promise<number>;
}

export const FAVORITE_REPOSITORY = Symbol('FAVORITE_REPOSITORY');
