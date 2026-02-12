import type {
  User,
  Subscription,
  UserUsage,
  Voice,
  ActivityLog,
  Prisma,
} from '@prisma/client';

// ==================== Types ====================
export interface UserWithSubscriptionsAndUsage extends User {
  subscriptions: Subscription[];
  usage: UserUsage | null;
}

// ==================== Repository Interface ====================
export interface IVoiceQuotaRepository {
  // Find user with active subscriptions and usage
  findUserWithSubscriptionsAndUsage(
    userId: string,
    currentDate: Date,
  ): Promise<UserWithSubscriptionsAndUsage | null>;

  // Find usage for a user
  findUserUsage(userId: string): Promise<UserUsage | null>;

  // Update usage month for multiple records
  updateUsageMonth(
    userId: string,
    excludeMonth: string,
    newMonth: string,
    resetData: Partial<UserUsage>,
    tx?: Prisma.TransactionClient,
  ): Promise<void>;

  // Upsert user usage
  upsertUserUsage(
    userId: string,
    createData: Partial<UserUsage>,
    updateData: Partial<UserUsage> | { [key: string]: any },
    tx?: Prisma.TransactionClient,
  ): Promise<UserUsage>;

  // Execute a transaction
  executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;

  // Create activity log
  createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog>;

  // Find voice by ID
  findVoiceById(voiceId: string): Promise<Voice | null>;

  // Find voice with user access check
  findVoiceWithAccess(voiceId: string, userId: string): Promise<Voice | null>;

  // Check if user has premium subscription
  findActiveSubscription(
    userId: string,
    currentDate: Date,
  ): Promise<Subscription | null>;
}

export const VOICE_QUOTA_REPOSITORY = Symbol('VOICE_QUOTA_REPOSITORY');
