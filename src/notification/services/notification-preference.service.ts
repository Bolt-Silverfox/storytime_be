import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationPreference,
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from '../dto/notification.dto';

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      const user = await this.prisma.user.findUnique({
        where: {
          id: dto.userId,
          isDeleted: false, // CANNOT CREATE PREFERENCES FOR SOFT DELETED USERS
        },
      });
      if (!user) throw new NotFoundException('User not found');
    }

    if (dto.kidId) {
      const kid = await this.prisma.kid.findUnique({
        where: {
          id: dto.kidId,
          isDeleted: false, // CANNOT CREATE PREFERENCES FOR SOFT DELETED KIDS
        },
      });
      if (!kid) throw new NotFoundException('Kid not found');
    }

    const pref = await this.prisma.notificationPreference.create({
      data: {
        type: dto.type,
        category: dto.category,
        enabled: dto.enabled,
        userId: dto.userId,
        kidId: dto.kidId,
      },
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async update(
    id: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.update({
      where: {
        id,
        isDeleted: false, // CANNOT UPDATE SOFT DELETED PREFERENCES
      },
      data: dto,
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT GET PREFERENCES FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET PREFERENCES FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        kidId,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        id,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
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

    const results: NotificationPreferenceDto[] = [];

    for (const type of channels) {
      const pref = await this.prisma.notificationPreference.upsert({
        where: {
          userId_category_type: {
            userId,
            category,
            type,
          },
        },
        create: {
          userId,
          category,
          type,
          enabled,
        },
        update: {
          enabled,
          isDeleted: false, // Restore if previously soft deleted
          deletedAt: null,
        },
      });
      results.push(this.toNotificationPreferenceDto(pref));
    }

    return results;
  }

  /**
   * Get user preferences in grouped format.
   * Returns a map of category -> {push: bool, in_app: bool}.
   */
  async getUserPreferencesGrouped(
    userId: string,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        isDeleted: false,
      },
    });

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
    const upsertOperations = categories.flatMap((category) => {
      const enabled = preferences[category];
      return channels.map((type) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_category_type: {
              userId,
              category,
              type,
            },
          },
          create: {
            userId,
            category,
            type,
            enabled,
          },
          update: {
            enabled,
            isDeleted: false,
            deletedAt: null,
          },
        }),
      );
    });

    await this.prisma.$transaction(upsertOperations);

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
    await this.prisma.notificationPreference.createMany({
      data: preferences,
      skipDuplicates: true,
    });

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
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        id,
        isDeleted: false, // CANNOT DELETE ALREADY DELETED PREFERENCES
      },
    });

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (permanent) {
      await this.prisma.notificationPreference.delete({
        where: { id },
      });
    } else {
      await this.prisma.notificationPreference.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }
  }

  /**
   * Restore a soft deleted notification preference
   * @param id Notification preference ID
   */
  async undoDelete(id: string): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { id },
    });

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (!pref.isDeleted) {
      throw new BadRequestException('Notification preference is not deleted');
    }

    const restored = await this.prisma.notificationPreference.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });

    return this.toNotificationPreferenceDto(restored);
  }
}
