import type {
  Kid,
  Avatar,
  Category,
  Voice,
  User,
  NotificationPreference,
  ActivityLog,
} from '@prisma/client';

/** Kid with loaded relations from Prisma queries */
export interface KidWithRelations extends Kid {
  avatar?: Avatar | null;
  preferredCategories?: Category[];
  preferredVoice?: Voice | null;
  parent?: Pick<User, 'id' | 'name' | 'email'>;
  notificationPreferences?: NotificationPreference[];
  activityLogs?: ActivityLog[];
}

export interface CreateKidData {
  name: string;
  dateOfBirth?: Date | string;
  preferredCategoryIds?: string[];
  avatarId?: string;
  parentId: string;
}

export interface UpdateKidData {
  name?: string;
  dateOfBirth?: Date | string;
  avatarId?: string;
  preferredCategoryIds?: string[];
  preferredVoiceId?: string;
}

export interface IKidRepository {
  // Basic CRUD
  create(data: CreateKidData): Promise<KidWithRelations>;
  findById(id: string): Promise<Kid | null>;
  findByIdNotDeleted(id: string): Promise<Kid | null>;
  findByIdWithRelations(id: string): Promise<KidWithRelations | null>;
  findByIdWithFullRelations(id: string): Promise<KidWithRelations | null>;
  findAllByParentId(parentId: string): Promise<KidWithRelations[]>;
  update(id: string, data: UpdateKidData): Promise<KidWithRelations>;

  // Soft delete operations
  softDelete(id: string): Promise<Kid>;
  restore(id: string): Promise<Kid>;
  hardDelete(id: string): Promise<Kid>;

  // Batch operations
  createMany(parentId: string, data: CreateKidData[]): Promise<void>;

  // Related entity operations
  countParentRecommendations(kidId: string): Promise<number>;
  findVoiceById(voiceId: string): Promise<Voice | null>;
  findUserByIdNotDeleted(userId: string): Promise<User | null>;
}

export const KID_REPOSITORY = Symbol('KID_REPOSITORY');
