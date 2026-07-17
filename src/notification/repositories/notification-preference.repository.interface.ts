import type {
  NotificationPreference,
  User,
  Kid,
  Prisma,
  NotificationCategory,
  NotificationType,
} from '@prisma/client';

// ==================== Repository Interface ====================
export interface INotificationPreferenceRepository {
  // Find user with isDeleted check
  findUser(userId: string): Promise<User | null>;

  // Find kid with isDeleted check
  findKid(kidId: string): Promise<Kid | null>;

  // Create notification preference
  createNotificationPreference(data: {
    type: NotificationType;
    category: NotificationCategory;
    enabled: boolean;
    userId?: string;
    kidId?: string;
  }): Promise<NotificationPreference>;

  // Update notification preference (only matches non-deleted rows)
  updateNotificationPreference(
    id: string,
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference>;

  // Update notification preference by id only (matches rows regardless of soft-delete state)
  updateNotificationPreferenceById(
    id: string,
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference>;

  // Find many notification preferences
  findManyNotificationPreferences(where: {
    userId?: string;
    kidId?: string;
    isDeleted: boolean;
  }): Promise<NotificationPreference[]>;

  // Find unique notification preference
  findUniqueNotificationPreference(
    id: string,
    includeDeleted?: boolean,
  ): Promise<NotificationPreference | null>;

  // Upsert notification preference (used in transactions)
  upsertNotificationPreference(
    where: {
      userId_category_type: {
        userId: string;
        category: NotificationCategory;
        type: NotificationType;
      };
    },
    create: {
      userId: string;
      category: NotificationCategory;
      type: NotificationType;
      enabled: boolean;
    },
    update: {
      enabled: boolean;
      isDeleted: boolean;
      deletedAt: null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationPreference>;

  // Execute transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;

  // Create many notification preferences
  createManyNotificationPreferences(
    data: {
      userId: string;
      category: NotificationCategory;
      type: NotificationType;
      enabled: boolean;
    }[],
  ): Promise<void>;

  // Find many notification preferences by IDs and userId
  findManyNotificationPreferencesByIds(
    ids: string[],
    userId: string,
  ): Promise<NotificationPreference[]>;

  // Find many notification preferences for a user, category and set of types
  findManyByUserCategoryAndTypes(
    userId: string,
    category: NotificationCategory,
    types: NotificationType[],
  ): Promise<NotificationPreference[]>;

  // Update the `enabled` flag of several preferences atomically (array-form transaction)
  bulkUpdateEnabledInTransaction(
    updates: { id: string; enabled?: boolean }[],
  ): Promise<NotificationPreference[]>;

  // Upsert several preferences atomically (array-form transaction)
  upsertManyInTransaction(
    items: {
      userId: string;
      category: NotificationCategory;
      type: NotificationType;
      enabled: boolean;
    }[],
  ): Promise<void>;

  // Delete notification preference (permanent)
  deleteNotificationPreference(id: string): Promise<void>;
}

export const NOTIFICATION_PREFERENCE_REPOSITORY = Symbol(
  'NOTIFICATION_PREFERENCE_REPOSITORY',
);
