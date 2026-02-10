import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IInAppNotificationRepository } from './in-app-notification.repository.interface';
import type { Notification } from '@prisma/client';

@Injectable()
export class PrismaInAppNotificationRepository
  implements IInAppNotificationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findNotifications(params: {
    userId: string;
    limit: number;
    offset: number;
    unreadOnly?: boolean;
  }): Promise<Notification[]> {
    const where: { userId: string; isDeleted: boolean; isRead?: boolean } = {
      userId: params.userId,
      isDeleted: false,
    };

    if (params.unreadOnly) {
      where.isRead = false;
    }

    return this.prisma.notification.findMany({
      where,
      take: params.limit,
      skip: params.offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countNotifications(params: {
    userId: string;
    unreadOnly?: boolean;
  }): Promise<number> {
    const where: { userId: string; isDeleted: boolean; isRead?: boolean } = {
      userId: params.userId,
      isDeleted: false,
    };

    if (params.unreadOnly) {
      where.isRead = false;
    }

    return this.prisma.notification.count({ where });
  }

  async markNotificationsAsRead(params: {
    userId: string;
    notificationIds: string[];
  }): Promise<{ count: number }> {
    return this.prisma.notification.updateMany({
      where: {
        id: { in: params.notificationIds },
        userId: params.userId,
      },
      data: {
        isRead: true,
      },
    });
  }

  async markAllNotificationsAsRead(userId: string): Promise<{ count: number }> {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }
}
