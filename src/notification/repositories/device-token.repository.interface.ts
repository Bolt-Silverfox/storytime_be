import type { DeviceToken, DevicePlatform, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IDeviceTokenRepository {
  // Find a device token by its unique token string
  findUniqueByToken(token: string): Promise<DeviceToken | null>;

  // Find the first non-deleted device token owned by a user with a given token
  findFirstByUserAndTokenNotDeleted(
    userId: string,
    token: string,
  ): Promise<DeviceToken | null>;

  // Find active device tokens for a user, ordered by lastUsed desc
  findActiveByUser(userId: string): Promise<DeviceToken[]>;

  // Find active, non-deleted device tokens for a user, ordered by createdAt desc
  findActiveNotDeletedByUser(userId: string): Promise<DeviceToken[]>;

  // Find token strings for the same device (used to deactivate stale device tokens)
  findTokensForDeviceDedup(params: {
    userId: string;
    platform: DevicePlatform;
    deviceName: string;
    token: string;
  }): Promise<{ token: string }[]>;

  // Find active mobile (ios/android) token strings for a user
  findActiveMobileTokens(userId: string): Promise<{ token: string }[]>;

  // Find active, non-deleted device tokens for a user, selecting id + token
  findActiveNotDeletedWithIds(
    userId: string,
  ): Promise<{ id: string; token: string }[]>;

  // Find a batch of all active, non-deleted device tokens (cursor pagination), selecting id + token
  findActiveNotDeletedBatch(params: {
    take: number;
    cursor?: string;
  }): Promise<{ id: string; token: string }[]>;

  // Count active mobile (ios/android) tokens for a user
  countActiveMobileTokens(userId: string): Promise<number>;

  // Count active web tokens for a user
  countActiveWebTokens(userId: string): Promise<number>;

  // Create a device token (optionally within a transaction)
  createToken(
    data: Prisma.DeviceTokenUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DeviceToken>;

  // Update a device token by its unique token string
  updateByToken(
    token: string,
    data: Prisma.DeviceTokenUncheckedUpdateInput,
  ): Promise<DeviceToken>;

  // Update a device token by id
  updateById(
    id: string,
    data: Prisma.DeviceTokenUncheckedUpdateInput,
  ): Promise<DeviceToken>;

  // Update many device tokens (optionally within a transaction)
  updateManyTokens(
    where: Prisma.DeviceTokenWhereInput,
    data: Prisma.DeviceTokenUncheckedUpdateManyInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }>;

  // Permanently delete stale device tokens (inactive OR unused before cutoff)
  deleteStaleTokens(cutoff: Date): Promise<{ count: number }>;

  // Execute a transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

export const DEVICE_TOKEN_REPOSITORY = Symbol('DEVICE_TOKEN_REPOSITORY');
