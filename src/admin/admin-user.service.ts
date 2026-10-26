import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PaginatedResponseDto } from './dto/admin-responses.dto';
import { UserFilterDto } from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  BulkActionDto,
} from './dto/user-management.dto';
import { ResetQuotaDto } from './dto/reset-quota.dto';
import {
  IAdminUserRepository,
  ADMIN_USER_REPOSITORY,
  IAdminPaymentRepository,
  ADMIN_PAYMENT_REPOSITORY,
} from './repositories';
import {
  CurrencyTotals,
  UNKNOWN_CURRENCY,
  addToCurrencyTotals,
  singleCurrencyTotal,
} from './utils/revenue-currency.util';
import {
  PAID_PLAN_WHERE,
  hasPaidAccess,
  isComplimentarySource,
} from '../subscription/subscription.constants';

/** Per-currency spend as a plain object, rounded to cents. Never mixes currencies. */
function spendingTotals(
  transactions: { amount: number; currency: string | null }[],
): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const txn of transactions) {
    addToCurrencyTotals(totals, txn.currency, txn.amount);
  }
  return totals;
}

/**
 * Headline spend: the plain total + its currency when the user paid in exactly
 * one currency (currency is null for the UNKNOWN bucket); 0 when nothing was
 * paid; amountSpent null when several currencies are involved.
 */
function headlineSpend(totals: CurrencyTotals) {
  const keys = Object.keys(totals);
  return {
    amountSpent: singleCurrencyTotal(totals),
    currency:
      keys.length === 1 && keys[0] !== UNKNOWN_CURRENCY ? keys[0] : null,
  };
}

@Injectable()
export class AdminUserService {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(ADMIN_PAYMENT_REPOSITORY)
    private readonly paymentRepo: IAdminPaymentRepository,
  ) {}

  async getAllUsers(
    filters: UserFilterDto,
  ): Promise<PaginatedResponseDto<any>> {
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

      // "Paid" = active, unexpired and NOT the free plan (a plan='free' row is
      // active for ~100 years but is not paid access).
      const activeSubscriptionCriteria = {
        ...PAID_PLAN_WHERE,
        status: 'active',
        isDeleted: false,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      };

      if (wantsActiveSubscription) {
        where.subscription = activeSubscriptionCriteria;
      } else {
        // AND (not OR) so a concurrent `search` — which already set where.OR —
        // is preserved. Assigning where.OR here previously clobbered the search
        // filter, so /admin/users/unpaid?search=... silently ignored the search.
        where.AND = [
          {
            OR: [
              { subscription: null },
              { subscription: { NOT: activeSubscriptionCriteria } },
            ],
          },
        ];
      }
    }

    // Build orderBy — handle computed fields that don't map to User columns
    const VALID_USER_SORT_FIELDS = [
      'createdAt',
      'updatedAt',
      'email',
      'name',
      'role',
      'isEmailVerified',
      'isDeleted',
      'isSuspended',
    ] as const;

    let orderBy: Prisma.UserOrderByWithRelationInput;
    if (sortBy === 'isPaidUser') {
      // Sort by subscription status (relation-based ordering)
      orderBy = { subscription: { status: sortOrder } };
    } else if (
      VALID_USER_SORT_FIELDS.includes(
        sortBy as (typeof VALID_USER_SORT_FIELDS)[number],
      )
    ) {
      orderBy = { [sortBy]: sortOrder };
    } else {
      orderBy = { createdAt: sortOrder };
    }

    const [users, total] = await Promise.all([
      this.userRepo.findManyWithDetails({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.userRepo.count(where),
    ]);

    return {
      data: users.map((user) => {
        // Sanitize user object - exclude sensitive fields
        const {
          passwordHash, // eslint-disable-line @typescript-eslint/no-unused-vars
          pinHash, // eslint-disable-line @typescript-eslint/no-unused-vars
          kids, // eslint-disable-line @typescript-eslint/no-unused-vars
          paymentTransactions, // eslint-disable-line @typescript-eslint/no-unused-vars
          usage, // eslint-disable-line @typescript-eslint/no-unused-vars
          subscription, // eslint-disable-line @typescript-eslint/no-unused-vars
          ...safeUser
        } = user;

        // Calculate metrics
        const creditUsed = user.usage?.elevenLabsCount || 0;
        const activityLength = user.kids.reduce(
          (total, kid) =>
            total +
            kid.screenTimeSessions.reduce(
              (sum, s) => sum + (s.duration || 0),
              0,
            ),
          0,
        );
        // Group spending by currency; amountSpent is only a plain number when
        // every transaction shares one currency (null if several).
        const spendingByCurrency = spendingTotals(user.paymentTransactions);
        const { amountSpent, currency } = headlineSpend(spendingByCurrency);

        const hasActiveSubscription = hasPaidAccess(user.subscription);

        return {
          ...safeUser,
          registrationDate: user.createdAt,
          activityLength,
          creditUsed,
          amountSpent,
          currency,
          spendingByCurrency,
          // Access, not payment: true for anyone with active paid ACCESS,
          // including complimentary grants (gating is unchanged).
          isPaidUser: hasActiveSubscription,
          // True when that active access is not a real store purchase.
          isComplimentary:
            hasActiveSubscription &&
            isComplimentarySource(user.subscription?.source),
          activeSubscription: hasActiveSubscription ? user.subscription : null,
          kidsCount: user._count.kids,
          sessionsCount: user._count.auth,
          favoritesCount: user._count.parentFavorites,
          transactionsCount: user._count.paymentTransactions,
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

  async getUserById(userId: string): Promise<any> {
    const user = await this.userRepo.findByIdWithDetails(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if user has active subscription
    const hasActiveSubscription = hasPaidAccess(user.subscription);

    const userTransactions =
      await this.paymentRepo.findSuccessfulByUser(userId);
    const spendingByCurrency = spendingTotals(userTransactions);
    const { amountSpent, currency } = headlineSpend(spendingByCurrency);

    // Resolve the granting admin's name (no FK on grantedByAdminId).
    const grantedByAdminId = user.subscription?.grantedByAdminId ?? null;
    const grantedBy = grantedByAdminId
      ? await this.userRepo.findById(grantedByAdminId)
      : null;
    const subscription = user.subscription
      ? {
          ...user.subscription,
          isComplimentary: isComplimentarySource(user.subscription.source),
          grantedByAdminName: grantedBy?.name ?? null,
        }
      : null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, pinHash, ...safeUser } = user;

    return {
      ...safeUser,
      subscription,
      isPaidUser: hasActiveSubscription,
      isComplimentary:
        hasActiveSubscription &&
        isComplimentarySource(user.subscription?.source),
      amountSpent,
      currency,
      spendingByCurrency,
      stats: {
        sessionsCount: user._count.auth,
        favoritesCount: user._count.parentFavorites,
        voicesCount: user._count.voices,
        ticketsCount: user._count.supportTickets,
        transactionsCount: user._count.paymentTransactions,
      },
      _count: undefined,
    };
  }

  async createAdmin(data: CreateAdminDto): Promise<any> {
    const existingUser = await this.userRepo.findByEmail(data.email);

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.userRepo.createAdmin({
      email: data.email,
      passwordHash,
      name: data.name,
    });
  }

  async updateUser(
    userId: string,
    data: UpdateUserDto,
    currentAdminId?: string,
  ): Promise<any> {
    // Safety check: prevent self-demotion
    if (userId === currentAdminId && data.role && data.role !== Role.admin) {
      throw new BadRequestException(
        'You cannot demote yourself from admin status.',
      );
    }

    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await this.userRepo.findByEmail(data.email);
      if (existingUser) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(data.name && { name: data.name }),
      ...(data.role && { role: data.role }),
      ...(data.email && { email: data.email }),
    };

    return this.userRepo.updateUserFields(userId, updateData);
  }

  async deleteUser(
    userId: string,
    permanent: boolean = false,
    currentAdminId?: string,
  ): Promise<any> {
    // Safety check: prevent self-deletion
    if (userId === currentAdminId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (permanent) {
      return this.userRepo.hardDeleteUser(userId);
    } else {
      return this.userRepo.softDeleteUser(userId);
    }
  }

  async restoreUser(userId: string): Promise<any> {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.userRepo.restoreUser(userId);
  }

  async bulkUserAction(data: BulkActionDto): Promise<{ count: number }> {
    const { userIds, action } = data;

    switch (action) {
      case 'delete': {
        const deleteResult = await this.userRepo.bulkSoftDelete(userIds);
        return { count: deleteResult.count };
      }

      case 'restore': {
        const restoreResult = await this.userRepo.bulkRestore(userIds);
        return { count: restoreResult.count };
      }

      case 'verify': {
        const verifyResult = await this.userRepo.bulkVerify(userIds);
        return { count: verifyResult.count };
      }

      default:
        throw new BadRequestException('Invalid action');
    }
  }

  async suspendUser(userId: string): Promise<any> {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.isSuspended) {
      throw new BadRequestException('User is already suspended');
    }

    if (user.role === Role.admin) {
      throw new BadRequestException('Cannot suspend an admin user');
    }

    return this.userRepo.suspendUser(userId);
  }

  async unsuspendUser(userId: string): Promise<any> {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!user.isSuspended) {
      throw new BadRequestException('User is not suspended');
    }

    return this.userRepo.unsuspendUser(userId);
  }

  async resetUserQuota(userId: string, body: ResetQuotaDto) {
    const usage = await this.userRepo.findUserUsage(userId);

    if (!usage) {
      throw new NotFoundException('User usage record not found');
    }

    const updateData: Prisma.UserUsageUpdateInput = {};

    if (body.resetStoryQuota) updateData.uniqueStoriesRead = 0;
    if (body.resetBonusStories) updateData.bonusStories = 0;
    if (body.resetElevenLabsCount) updateData.elevenLabsCount = 0;
    if (body.resetGeminiStory) updateData.geminiStoryCount = 0;
    if (body.resetGeminiImage) updateData.geminiImageCount = 0;
    if (body.resetVoiceLock) {
      updateData.selectedSecondVoice = { disconnect: true };
      updateData.elevenLabsTrialStory = { disconnect: true };
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No quota fields selected for reset');
    }

    return this.userRepo.updateUserUsage(userId, updateData);
  }
}
