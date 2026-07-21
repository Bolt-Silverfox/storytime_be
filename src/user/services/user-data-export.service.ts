import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../repositories/user.repository.interface';

/** Shape of the GDPR data-portability export (a self-describing JSON document). */
export interface UserDataExportResult {
  meta: {
    format: string;
    exportedAt: string;
    userId: string;
  };
  account: Record<string, unknown>;
  profile: unknown;
  avatar: unknown;
  subscription: unknown;
  paymentTransactions: unknown;
  notifications: unknown;
  notificationPreferences: unknown;
  parentFavorites: unknown;
  userStoryProgress: unknown;
  learningExpectations: unknown;
  couponRedemptions: unknown;
  voices: unknown;
  badges: unknown;
  supportTickets: unknown;
  preferredCategories: unknown;
  kids: unknown;
}

export const USER_DATA_EXPORT_FORMAT = 'storytime-data-export-v1';

/**
 * GDPR "right to data portability": assembles all of a user's own data (and
 * their kids') into a single downloadable JSON document. Secrets
 * (`passwordHash`, `pinHash`) are stripped; internal audit/security logs and
 * payment-gateway tokens are intentionally out of scope (see USER_EXPORT_INCLUDE).
 */
@Injectable()
export class UserDataExportService {
  private readonly logger = new Logger(UserDataExportService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async exportUserData(
    userId: string,
    exportedAt: string,
  ): Promise<UserDataExportResult> {
    const data = await this.userRepository.findUserForExport(userId);
    if (!data) {
      throw new NotFoundException('User not found');
    }

    // Split the top-level relations out of the scalar account fields.
    const {
      profile,
      avatar,
      subscription,
      paymentTransactions,
      notifications,
      notificationPreferences,
      parentFavorites,
      userStoryProgress,
      learningExpectations,
      couponRedemptions,
      voices,
      badges,
      supportTickets,
      preferredCategories,
      kids,
      ...accountFields
    } = data;

    // Strip secrets from the scalar account fields.
    const account = { ...accountFields } as Record<string, unknown>;
    delete account.passwordHash;
    delete account.pinHash;

    this.logger.log(`Generated GDPR data export for user ${userId}`);

    return {
      meta: {
        format: USER_DATA_EXPORT_FORMAT,
        exportedAt,
        userId,
      },
      account,
      profile,
      avatar,
      subscription,
      paymentTransactions,
      notifications,
      notificationPreferences,
      parentFavorites,
      userStoryProgress,
      learningExpectations,
      couponRedemptions,
      voices,
      badges,
      supportTickets,
      preferredCategories,
      kids,
    };
  }
}
