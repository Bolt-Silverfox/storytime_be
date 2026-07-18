import type { Prisma } from '@prisma/client';

// ==================== Types ====================
export type KidParentId = Prisma.KidGetPayload<{
  select: { parentId: true };
}>;

export type KidWithAvatar = Prisma.KidGetPayload<{
  include: { avatar: true };
}>;

export type KidWithAvatarAndActivity = Prisma.KidGetPayload<{
  include: { avatar: true; activityLogs: true };
}>;

// ==================== Repository Interface ====================
export interface IKidRepository {
  // Find only the parentId for a kid
  findParentIdByKidId(id: string): Promise<KidParentId | null>;

  // Find all kids for a parent, including their avatar
  findKidsByParentWithAvatar(parentId: string): Promise<KidWithAvatar[]>;

  // Find a kid with avatar and their most recent activity log
  findKidWithAvatarAndActivity(
    id: string,
  ): Promise<KidWithAvatarAndActivity | null>;
}

export const KID_REPOSITORY = Symbol('KID_REPOSITORY');
