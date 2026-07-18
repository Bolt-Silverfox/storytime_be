import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Role, User, UserUsage } from '@prisma/client';
import type {
  IAdminUserRepository,
  AdminUserListItem,
  AdminUserDetail,
  AdminUserGrowthRow,
  AdminUserGrowthMonthlyRow,
} from './admin-user.repository.interface';

@Injectable()
export class PrismaAdminUserRepository implements IAdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(where: Prisma.UserWhereInput): Promise<number> {
    return this.prisma.user.count({ where });
  }

  findManyWithSubscription(params: {
    where: Prisma.UserWhereInput;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<AdminUserGrowthRow[]> {
    return this.prisma.user.findMany({
      where: params.where,
      include: {
        subscription: true,
      },
      orderBy: params.orderBy,
    });
  }

  findManyForGrowthMonthly(
    startDate: Date,
  ): Promise<AdminUserGrowthMonthlyRow[]> {
    return this.prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
        isDeleted: false,
      },
      select: {
        createdAt: true,
        id: true,
        subscription: true,
      },
    });
  }

  findManyWithDetails(params: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<AdminUserListItem[]> {
    return this.prisma.user.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: {
        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            endsAt: true,
          },
        },
        profile: true,
        avatar: true,
        usage: {
          select: { elevenLabsCount: true },
        },
        kids: {
          select: {
            screenTimeSessions: {
              select: { duration: true },
            },
          },
        },
        paymentTransactions: {
          where: { status: 'success', deletedAt: null },
          select: { amount: true, currency: true },
        },
        _count: {
          select: {
            kids: true,
            auth: true,
            parentFavorites: true,
            paymentTransactions: true,
          },
        },
      },
    });
  }

  findByIdWithDetails(userId: string): Promise<AdminUserDetail | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kids: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            ageRange: true,
            createdAt: true,
            avatar: true,
          },
        },
        avatar: true,
        subscription: true,
        usage: true,
        paymentTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            auth: true,
            parentFavorites: true,
            voices: true,
            supportTickets: true,
            paymentTransactions: true,
          },
        },
      },
    });
  }

  findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findActiveById(userId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
    });
  }

  createAdmin(data: {
    email: string;
    passwordHash: string;
    name: string;
  }): Promise<Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        role: Role.admin,
        isEmailVerified: true,
        profile: {
          create: {
            country: 'NG',
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  updateUserFields(
    userId: string,
    data: Prisma.UserUpdateInput,
  ): Promise<
    Pick<
      User,
      'id' | 'email' | 'name' | 'role' | 'isEmailVerified' | 'updatedAt'
    >
  > {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isEmailVerified: true,
        updatedAt: true,
      },
    });
  }

  hardDeleteUser(userId: string): Promise<User> {
    return this.prisma.user.delete({ where: { id: userId } });
  }

  softDeleteUser(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  restoreUser(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  suspendUser(
    userId: string,
  ): Promise<
    Pick<
      User,
      | 'id'
      | 'email'
      | 'name'
      | 'role'
      | 'isSuspended'
      | 'suspendedAt'
      | 'updatedAt'
    >
  > {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: true,
        suspendedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuspended: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
  }

  unsuspendUser(
    userId: string,
  ): Promise<
    Pick<
      User,
      | 'id'
      | 'email'
      | 'name'
      | 'role'
      | 'isSuspended'
      | 'suspendedAt'
      | 'updatedAt'
    >
  > {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: false,
        suspendedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuspended: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
  }

  async bulkSoftDelete(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async bulkRestore(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async bulkVerify(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isEmailVerified: true,
      },
    });
  }

  findUserUsage(userId: string): Promise<UserUsage | null> {
    return this.prisma.userUsage.findUnique({
      where: { userId },
    });
  }

  updateUserUsage(
    userId: string,
    data: Prisma.UserUsageUpdateInput,
  ): Promise<UserUsage> {
    return this.prisma.userUsage.update({
      where: { userId },
      data,
    });
  }
}
