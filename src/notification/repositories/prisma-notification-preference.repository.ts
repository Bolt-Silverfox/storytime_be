import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { INotificationPreferenceRepository } from './notification-preference.repository.interface';
import type {
  NotificationPreference,
  User,
  Kid,
  Prisma,
  NotificationCategory,
  NotificationType,
} from '@prisma/client';

@Injectable()
export class PrismaNotificationPreferenceRepository
  implements INotificationPreferenceRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findUser(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
  }

  async findKid(kidId: string): Promise<Kid | null> {
    return this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false,
      },
    });
  }

  async createNotificationPreference(data: {
    type: NotificationType;
    category: NotificationCategory;
    enabled: boolean;
    userId?: string;
    kidId?: string;
  }): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.create({
      data,
    });
  }

  async updateNotificationPreference(
    id: string,
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.update({
      where: {
        id,
        isDeleted: false,
      },
      data,
    });
  }

  async findManyNotificationPreferences(where: {
    userId?: string;
    kidId?: string;
    isDeleted: boolean;
  }): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where,
    });
  }

  async findUniqueNotificationPreference(
    id: string,
    includeDeleted: boolean = false,
  ): Promise<NotificationPreference | null> {
    return this.prisma.notificationPreference.findUnique({
      where: includeDeleted
        ? { id }
        : {
            id,
            isDeleted: false,
          },
    });
  }

  async upsertNotificationPreference(
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
  ): Promise<NotificationPreference> {
    const client = tx || this.prisma;
    return client.notificationPreference.upsert({
      where,
      create,
      update,
    });
  }

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  async createManyNotificationPreferences(
    data: {
      userId: string;
      category: NotificationCategory;
      type: NotificationType;
      enabled: boolean;
    }[],
  ): Promise<void> {
    await this.prisma.notificationPreference.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async deleteNotificationPreference(id: string): Promise<void> {
    await this.prisma.notificationPreference.delete({
      where: { id },
    });
  }
}
