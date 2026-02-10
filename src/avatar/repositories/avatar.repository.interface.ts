import { Avatar, User, Kid } from '@prisma/client';

export interface IAvatarRepository {
  // Avatar CRUD
  findById(id: string): Promise<Avatar | null>;
  findByIdNotDeleted(id: string): Promise<Avatar | null>;
  findByName(name: string): Promise<Avatar | null>;
  findAll(includeDeleted?: boolean): Promise<Avatar[]>;
  findSystemAvatars(): Promise<Avatar[]>;
  findAllSystemAvatars(): Promise<Avatar[]>;

  create(data: {
    name: string;
    url: string;
    publicId?: string | null;
    isSystemAvatar: boolean;
    createdBy?: string;
  }): Promise<Avatar>;

  update(
    id: string,
    data: Partial<Pick<Avatar, 'name' | 'url' | 'publicId'>>,
  ): Promise<Avatar>;

  upsertByName(
    name: string,
    data: {
      url: string;
      publicId?: string | null;
      isSystemAvatar: boolean;
    },
  ): Promise<Avatar>;

  softDelete(id: string): Promise<Avatar>;
  hardDelete(id: string): Promise<Avatar>;
  restore(id: string): Promise<Avatar>;

  // Usage counts for validation
  countUsersUsingAvatar(avatarId: string): Promise<number>;
  countKidsUsingAvatar(avatarId: string): Promise<number>;

  // User/Kid avatar assignment
  findUserById(userId: string): Promise<User | null>;
  findUserWithAvatar(userId: string): Promise<(User & { avatar: Avatar | null }) | null>;
  updateUserAvatar(userId: string, avatarId: string): Promise<User & { avatar: Avatar | null }>;

  findKidById(kidId: string): Promise<Kid | null>;
  findKidWithAvatar(kidId: string): Promise<(Kid & { avatar: Avatar | null }) | null>;
  updateKidAvatar(kidId: string, avatarId: string): Promise<Kid & { avatar: Avatar | null }>;
}

export const AVATAR_REPOSITORY = Symbol('AVATAR_REPOSITORY');
