import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import {
  NotificationPreference,
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  BulkUpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from '../dto/notification.dto';
import {
  INotificationPreferenceRepository,
  NOTIFICATION_PREFERENCE_REPOSITORY,
} from '../repositories';

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly notificationPreferenceRepository: INotificationPreferenceRepository,
  ) {}

  private toNotificationPreferenceDto(
    pref: NotificationPreference,
  ): NotificationPreferenceDto {
    return {
      id: pref.id,
      type: pref.type,
      category: pref.category,
      enabled: pref.enabled,
      userId: pref.userId ?? undefined,
      kidId: pref.kidId ?? undefined,
      createdAt: pref.createdAt,
      updatedAt: pref.updatedAt,
    };
  }

  async create(
    dto: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    // Verify user or kid exists and is not soft deleted
    if (dto.userId) {
      const user = await this.notificationPreferenceRepository.findUser(
        dto.userId,
      );
      if (!user) throw new NotFoundException('User not found');
    }

    if (dto.kidId) {
      const kid = await this.notificationPreferenceRepository.findKid(
        dto.kidId,
      );
      if (!kid) throw new NotFoundException('Kid not found');
    }

    const pref =
      await this.notificationPreferenceRepository.createNotificationPreference({
        type: dto.type,
        category: dto.category,
        enabled: dto.enabled,
        userId: dto.userId,
        kidId: dto.kidId,
      });
    return this.toNotificationPreferenceDto(pref);
  }

  async update(
    id: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    const pref =
      await this.notificationPreferenceRepository.updateNotificationPreference(
        id,
        dto,
      );
    return this.toNotificationPreferenceDto(pref);
  }

  async bulkUpdate(
    userId: string,
    dtos: BulkUpdateNotificationPreferenceDto[],
  ): Promise<NotificationPreferenceDto[]> {
    // Verify all preferences belong to the user
    const prefIds = dtos.map((d) => d.id);
    const existing =
      await this.notificationPreferenceRepository.findManyNotificationPreferencesByIds(
        prefIds,
        userId,
      );

    if (existing.length !== prefIds.length) {
      throw new NotFoundException(
        'One or more notification preferences not found for this user',
      );
    }

    // Perform atomic update via transaction
    const updatedPrefs =
      await this.notificationPreferenceRepository.executeTransaction(
        async () => {
          const results = [];
          for (const dto of dtos) {
            const updated =
              await this.notificationPreferenceRepository.updateNotificationPreference(
                dto.id,
                { enabled: dto.enabled },
              );
            results.push(updated);
          }
          return results;
        },
      );

    return updatedPrefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    const user = await this.notificationPreferenceRepository.findUser(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const prefs =
      await this.notificationPreferenceRepository.findManyNotificationPreferences(
        {
          userId,
          isDeleted: false,
        },
      );
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    const kid = await this.notificationPreferenceRepository.findKid(kidId);

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const prefs =
      await this.notificationPreferenceRepository.findManyNotificationPreferences(
        {
          kidId,
          isDeleted: false,
        },
      );
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    const pref =
      await this.notificationPreferenceRepository.findUniqueNotificationPreference(
        id,
        false,
      );
    if (!pref) throw new NotFoundException('Notification preference not found');
    return this.toNotificationPreferenceDto(pref);
  }

  /**
   * Toggle a category preference for both in_app and push channels.
   * Used by the settings UI when the user toggles a category on/off.
   */
  async toggleCategoryPreference(
    userId: string,
    category: PrismaCategory,
    enabled: boolean,
  ): Promise<NotificationPreferenceDto[]> {
    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    // Batch all upserts in a single transaction to avoid sequential queries
    const prefs =
      await this.notificationPreferenceRepository.executeTransaction(
        async (tx) => {
          const results = [];
          for (const type of channels) {
            const pref =
              await this.notificationPreferenceRepository.upsertNotificationPreference(
                {
                  userId_category_type: {
                    userId,
                    category,
                    type,
                  },
                },
                {
                  userId,
                  category,
                  type,
                  enabled,
                },
                {
                  enabled,
                  isDeleted: false,
                  deletedAt: null,
                },
                tx,
              );
            results.push(pref);
          }
          return results;
        },
      );

    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  /**
   * Get user preferences in grouped format.
   * Returns a map of category -> {push: bool, in_app: bool}.
   */
  async getUserPreferencesGrouped(
    userId: string,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    const prefs =
      await this.notificationPreferenceRepository.findManyNotificationPreferences(
        {
          userId,
          isDeleted: false,
        },
      );

    // Group by category with per-channel status
    const grouped: Record<string, { push: boolean; in_app: boolean }> = {};

    for (const pref of prefs) {
      if (!grouped[pref.category]) {
        grouped[pref.category] = {
          push: true, // Default to enabled
          in_app: true, // Default to enabled
        };
      }

      if (pref.type === PrismaNotificationType.push) {
        grouped[pref.category].push = pref.enabled;
      } else if (pref.type === PrismaNotificationType.in_app) {
        grouped[pref.category].in_app = pref.enabled;
      }
    }

    return grouped;
  }

  /**
   * Update user preferences in bulk. Each category update affects both push and in_app channels.
   * Example: { "NEW_STORY": true, "STORY_FINISHED": false }
   */
  async updateUserPreferences(
    userId: string,
    preferences: Record<string, boolean>,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    const categories = Object.keys(preferences) as PrismaCategory[];
    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    // Batch all upserts in a single transaction to avoid N+1 queries
    await this.notificationPreferenceRepository.executeTransaction(
      async (tx) => {
        for (const category of categories) {
          const enabled = preferences[category];
          for (const type of channels) {
            await this.notificationPreferenceRepository.upsertNotificationPreference(
              {
                userId_category_type: {
                  userId,
                  category,
                  type,
                },
              },
              {
                userId,
                category,
                type,
                enabled,
              },
              {
                enabled,
                isDeleted: false,
                deletedAt: null,
              },
              tx,
            );
          }
        }
      },
    );

    return this.getUserPreferencesGrouped(userId);
  }

  /**
   * Seed default notification preferences for a new user.
   * Creates preferences for all user-facing categories with enabled: true.
   * Called during user registration.
   */
  async seedDefaultPreferences(userId: string): Promise<void> {
    // User-facing categories that should have preferences (excludes auth/system categories)
    const userFacingCategories: PrismaCategory[] = [
      // Subscription & Billing
      PrismaCategory.SUBSCRIPTION_REMINDER,
      PrismaCategory.SUBSCRIPTION_ALERT,
      // Engagement / Discovery
      PrismaCategory.NEW_STORY,
      PrismaCategory.STORY_FINISHED,
      // Reminders
      PrismaCategory.INCOMPLETE_STORY_REMINDER,
      PrismaCategory.DAILY_LISTENING_REMINDER,
    ];

    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    const preferences = userFacingCategories.flatMap((category) =>
      channels.map((type) => ({
        userId,
        category,
        type,
        enabled: true,
      })),
    );

    // Use createMany with skipDuplicates to avoid errors if preferences already exist
    await this.notificationPreferenceRepository.createManyNotificationPreferences(
      preferences,
    );

    this.logger.log(
      `Seeded ${preferences.length} default preferences for user ${userId}`,
    );
  }

  /**
   * Soft delete or permanently delete a notification preference
   * @param id Notification preference ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async delete(id: string, permanent: boolean = false): Promise<void> {
    const pref =
      await this.notificationPreferenceRepository.findUniqueNotificationPreference(
        id,
        false,
      );

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (permanent) {
      await this.notificationPreferenceRepository.deleteNotificationPreference(
        id,
      );
    } else {
      await this.notificationPreferenceRepository.updateNotificationPreference(
        id,
        {
          isDeleted: true,
          deletedAt: new Date(),
        },
      );
    }
  }

  /**
   * Restore a soft deleted notification preference
   * @param id Notification preference ID
   */
  async undoDelete(id: string): Promise<NotificationPreferenceDto> {
    const pref =
      await this.notificationPreferenceRepository.findUniqueNotificationPreference(
        id,
        true,
      );

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (!pref.isDeleted) {
      throw new BadRequestException('Notification preference is not deleted');
    }

    const restored =
      await this.notificationPreferenceRepository.updateNotificationPreference(
        id,
        {
          isDeleted: false,
          deletedAt: null,
        },
      );

    return this.toNotificationPreferenceDto(restored);
  }
}
