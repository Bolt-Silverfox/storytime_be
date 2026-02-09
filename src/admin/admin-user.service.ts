import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  PaginatedResponseDto,
  UserListItemDto,
  AdminCreatedDto,
  UserUpdatedDto,
} from './dto/admin-responses.dto';
import { UserFilterDto } from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  BulkActionDto,
} from './dto/user-management.dto';

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllUsers(
    filters: UserFilterDto,
  ): Promise<PaginatedResponseDto<UserListItemDto>> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      role,
      isEmailVerified,
      isDeleted,
      createdAfter,
      createdBefore,
    } = filters;

    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) where.role = role;
    if (isEmailVerified !== undefined) where.isEmailVerified = isEmailVerified;

    if (isDeleted !== undefined) where.isDeleted = isDeleted;

    if (createdAfter || createdBefore) {
      where.createdAt = {};
      if (createdAfter) where.createdAt.gte = new Date(createdAfter);
      if (createdBefore) where.createdAt.lte = new Date(createdBefore);
    }

    // Filter by subscription status
    const hasActiveSub = filters.hasActiveSubscription;
    if (hasActiveSub !== undefined && hasActiveSub !== null) {
      const now = new Date();
      // Normalize value - handle both boolean and string (query params may come as strings)
      const wantsActiveSubscription =
        hasActiveSub === true || String(hasActiveSub) === 'true';

      const activeSubscriptionCriteria = {
        status: 'active',
        isDeleted: false,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      };

      if (wantsActiveSubscription) {
        where.subscriptions = {
          some: activeSubscriptionCriteria,
        };
      } else {
        where.NOT = {
          subscriptions: {
            some: activeSubscriptionCriteria,
          },
        };
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
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
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => {
        // Sanitize user object - exclude sensitive fields
        const {
          passwordHash: _passwordHash,
          pinHash: _pinHash,
          kids,
          paymentTransactions,
          usage,
          subscriptions,
          _count,
          ...safeUser
        } = user;

        // Calculate metrics
        const creditUsed = usage?.elevenLabsCount || 0;
        const activityLength = kids.reduce(
          (total, kid) =>
            total +
            kid.screenTimeSessions.reduce(
              (sum, s) => sum + (s.duration || 0),
              0,
            ),
          0,
        );
        const amountSpent = paymentTransactions.reduce(
          (sum, txn) => sum + txn.amount,
          0,
        );

        return {
          ...safeUser,
          registrationDate: user.createdAt,
          activityLength,
          creditUsed,
          amountSpent,
          isPaidUser: subscriptions.length > 0,
          activeSubscription: subscriptions[0] || null,
          kidsCount: _count.kids,
          sessionsCount: _count.auth,
          favoritesCount: _count.parentFavorites,
          subscriptionsCount: _count.subscriptions,
          transactionsCount: _count.paymentTransactions,
        };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string): Promise<
    Omit<User, 'passwordHash' | 'pinHash'> & {
      isPaidUser: boolean;
      totalSpent: number;
      stats: {
        sessionsCount: number;
        favoritesCount: number;
        voicesCount: number;
        subscriptionsCount: number;
        ticketsCount: number;
        transactionsCount: number;
      };
    }
  > {
    const user = await this.prisma.user.findUnique({
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
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if user has active subscription
    const now = new Date();
    const hasActiveSubscription = user.subscriptions.some(
      (sub) => sub.status === 'active' && (!sub.endsAt || sub.endsAt > now),
    );

    const totalSpentResult = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId: userId,
        status: 'success',
      },
      _sum: {
        amount: true,
      },
    });

    const {
      passwordHash: _passwordHash,
      pinHash: _pinHash,
      _count,
      ...safeUser
    } = user;

    return {
      ...safeUser,
      isPaidUser: hasActiveSubscription,
      totalSpent: totalSpentResult._sum.amount || 0,
      stats: {
        sessionsCount: _count.auth,
        favoritesCount: _count.parentFavorites,
        voicesCount: _count.voices,
        subscriptionsCount: _count.subscriptions,
        ticketsCount: _count.supportTickets,
        transactionsCount: _count.paymentTransactions,
      },
    };
  }

  async createAdmin(data: CreateAdminDto): Promise<AdminCreatedDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
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

  async updateUser(
    userId: string,
    data: UpdateUserDto,
    currentAdminId?: string,
  ): Promise<UserUpdatedDto> {
    // Safety check: prevent self-demotion
    if (userId === currentAdminId && data.role && data.role !== Role.admin) {
      throw new BadRequestException(
        'You cannot demote yourself from admin status.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existingUser) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(data.name && { name: data.name }),
      ...(data.role && { role: data.role }),
      ...(data.email && { email: data.email }),
    };

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
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

  async deleteUser(
    userId: string,
    permanent: boolean = false,
    currentAdminId?: string,
  ): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }> {
    // Safety check: prevent self-deletion
    if (userId === currentAdminId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const selectFields = {
      id: true,
      email: true,
      name: true,
      role: true,
      isDeleted: true,
      deletedAt: true,
    } as const;

    if (permanent) {
      return this.prisma.user.delete({
        where: { id: userId },
        select: selectFields,
      });
    } else {
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
        select: selectFields,
      });
    }
  }

  async restoreUser(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    isDeleted: boolean;
    deletedAt: Date | null;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

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

  async bulkUserAction(data: BulkActionDto): Promise<{ count: number }> {
    const { userIds, action } = data;

    switch (action) {
      case 'delete': {
        const deleteResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });
        return { count: deleteResult.count };
      }

      case 'restore': {
        const restoreResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: false,
            deletedAt: null,
          },
        });
        return { count: restoreResult.count };
      }

      case 'verify': {
        const verifyResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isEmailVerified: true,
          },
        });
        return { count: verifyResult.count };
      }

      default:
        throw new BadRequestException('Invalid action');
    }
  }
}
