import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IAdminUserRepository,
  UserWithRelations,
  UserDetail,
} from './admin-user.repository.interface';
import type { Prisma, User } from '@prisma/client';

@Injectable()
export class PrismaAdminUserRepository implements IAdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUsers(params: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.UserOrderByWithRelationInput;
  }): Promise<UserWithRelations[]> {
    return this.prisma.user.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: {
        subscriptions: {
          where: {
            status: 'active',
            isDeleted: false,
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
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
          where: { status: 'success' },
          select: { amount: true },
        },
        _count: {
          select: {
            kids: true,
            auth: true,
            parentFavorites: true,
            subscriptions: true,
            paymentTransactions: true,
          },
        },
      },
    }) as Promise<UserWithRelations[]>;
  }

  async countUsers(where: Prisma.UserWhereInput): Promise<number> {
    return this.prisma.user.count({ where });
  }

  async findUserById(userId: string): Promise<UserDetail | null> {
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
        subscriptions: {
          orderBy: { startedAt: 'desc' },
        },
        paymentTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            auth: true,
            parentFavorites: true,
            voices: true,
            subscriptions: true,
            supportTickets: true,
            paymentTransactions: true,
          },
        },
      },
    }) as Promise<UserDetail | null>;
  }

  async aggregatePaymentTransactions(params: {
    userId: string;
    status: string;
  }): Promise<{ _sum: { amount: number | null } }> {
    return this.prisma.paymentTransaction.aggregate({
      where: {
        userId: params.userId,
        status: params.status,
      },
      _sum: {
        amount: true,
      },
    });
  }

  async userExistsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email },
    });
    return count > 0;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    name: string;
    role: string;
    isEmailVerified: boolean;
    profile: { country: string };
  }): Promise<{
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: Date;
  }> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role as any,
        isEmailVerified: data.isEmailVerified,
        profile: {
          create: {
            country: data.profile.country,
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

  async findUserByIdSimple(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async updateUser(params: {
    userId: string;
    data: Prisma.UserUpdateInput;
  }): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isEmailVerified: boolean;
    updatedAt: Date;
  }> {
    return this.prisma.user.update({
      where: { id: params.userId },
      data: params.data,
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

  async softDeleteUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isDeleted: true,
        deletedAt: true,
      },
    });
  }

  async hardDeleteUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }> {
    return this.prisma.user.delete({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isDeleted: true,
        deletedAt: true,
      },
    });
  }

  async restoreUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isDeleted: true,
        deletedAt: true,
      },
    });
  }

  async bulkSoftDeleteUsers(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async bulkRestoreUsers(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async bulkVerifyUsers(userIds: string[]): Promise<{ count: number }> {
    return this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        isEmailVerified: true,
      },
    });
  }
}
