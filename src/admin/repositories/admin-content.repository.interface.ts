export interface CategorySeedInput {
  name: string;
  image: string;
  description: string;
}

export interface ThemeSeedInput {
  name: string;
  image: string;
  description: string;
}

export interface AgeGroupSeedInput {
  name: string;
  min: number;
  max: number;
}

export interface AvatarSeedInput {
  name: string;
  url: string;
}

export interface ContentBreakdownRow {
  name: string;
  _count: { stories: number };
}

export interface IAdminContentRepository {
  // Dashboard / stats counts
  countCategories(): Promise<number>;
  countThemes(): Promise<number>;

  // Content breakdown (name + story counts)
  findCategoryBreakdown(): Promise<ContentBreakdownRow[]>;
  findThemeBreakdown(): Promise<ContentBreakdownRow[]>;

  // Seed helpers (find-first variant — used by AdminService.seedDatabase)
  seedCategoryByFind(category: CategorySeedInput): Promise<void>;
  seedSystemAvatarWithFlags(avatar: AvatarSeedInput): Promise<void>;

  // Seed helpers (upsert variant — used by AdminSystemService.seedDatabase)
  upsertCategorySeed(category: CategorySeedInput): Promise<void>;
  seedSystemAvatar(avatar: AvatarSeedInput): Promise<void>;

  // Seed helpers shared by both seeders (byte-identical queries)
  seedTheme(theme: ThemeSeedInput): Promise<void>;
  seedAgeGroup(ageGroup: AgeGroupSeedInput): Promise<void>;
}

export const ADMIN_CONTENT_REPOSITORY = Symbol('ADMIN_CONTENT_REPOSITORY');
