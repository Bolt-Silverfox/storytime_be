import {
  Injectable,
  Inject,
} from '@nestjs/common';
import {
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
  ValidationException,
} from '@/shared/exceptions';
import { Role, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  IAdminUserRepository,
  ADMIN_USER_REPOSITORY,
} from './repositories';
import { PasswordService } from '../auth/services/password.service';
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
  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly adminUserRepository: IAdminUserRepository,
    private readonly passwordService: PasswordService,
  ) { }

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
      this.adminUserRepository.findUsers({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.adminUserRepository.countUsers(where),
    ]);

    return {
      data: users.map((user) => {
        // Sanitize user object - exclude sensitive fields
        /* eslint-disable @typescript-eslint/no-unused-vars */
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
        /* eslint-enable @typescript-eslint/no-unused-vars */

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
    const user = await this.adminUserRepository.findUserById(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    // Check if user has active subscription
    const now = new Date();
    const hasActiveSubscription = user.subscriptions.some(
      (sub) => sub.status === 'active' && (!sub.endsAt || sub.endsAt > now),
    );

    const totalSpentResult = await this.adminUserRepository.aggregatePaymentTransactions({
      userId,
      status: 'success',
    });

    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      passwordHash: _passwordHash,
      pinHash: _pinHash,
      _count,
      ...safeUser
    } = user;
    /* eslint-enable @typescript-eslint/no-unused-vars */

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
    const existingUser = await this.adminUserRepository.findUserByEmail(data.email);

    if (existingUser) {
      throw new ResourceAlreadyExistsException('User', 'email', data.email);
    }

    const passwordHash = await this.passwordService.hashPassword(data.password);

    return this.adminUserRepository.createUser({
      email: data.email,
      passwordHash,
      name: data.name,
      role: Role.admin,
      isEmailVerified: true,
      profile: {
        country: 'NG',
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
      throw new ValidationException(
        'You cannot demote yourself from admin status.',
      );
    }

    const user = await this.adminUserRepository.findUserByIdSimple(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await this.adminUserRepository.findUserByEmail(data.email);
      if (existingUser) {
        throw new ResourceAlreadyExistsException('User', 'email', data.email);
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(data.name && { name: data.name }),
      ...(data.role && { role: data.role }),
      ...(data.email && { email: data.email }),
    };

    return this.adminUserRepository.updateUser({
      userId,
      data: updateData,
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
      throw new ValidationException('You cannot delete your own account.');
    }

    const user = await this.adminUserRepository.findUserByIdSimple(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    if (permanent) {
      return this.adminUserRepository.hardDeleteUser(userId);
    } else {
      return this.adminUserRepository.softDeleteUser(userId);
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
    const user = await this.adminUserRepository.findUserByIdSimple(userId);

    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }

    return this.adminUserRepository.restoreUser(userId);
  }

  async bulkUserAction(data: BulkActionDto): Promise<{ count: number }> {
    const { userIds, action } = data;

    switch (action) {
      case 'delete':
        return this.adminUserRepository.bulkSoftDeleteUsers(userIds);

      case 'restore':
        return this.adminUserRepository.bulkRestoreUsers(userIds);

      case 'verify':
        return this.adminUserRepository.bulkVerifyUsers(userIds);

      default:
        throw new ValidationException('Invalid action');
    }
  }
}
