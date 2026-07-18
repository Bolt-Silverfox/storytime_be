import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IUserBadgeRepository,
  UserBadgeWithBadge,
  UserBadgeCompositeKey,
} from './user-badge.repository.interface';
import type { UserBadge, Prisma } from '@prisma/client';

@Injectable()
export class PrismaUserBadgeRepository implements IUserBadgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createUserBadgesInTransaction(
    data: Prisma.UserBadgeUncheckedCreateInput[],
  ): Promise<UserBadge[]> {
    return this.prisma.$transaction(
      data.map((d) => this.prisma.userBadge.create({ data: d })),
    );
  }

  async findPreviewBadges(
    where: Prisma.UserBadgeWhereInput,
    take: number,
  ): Promise<UserBadgeWithBadge[]> {
    return this.prisma.userBadge.findMany({
      where,
      include: {
        badge: true,
      },
      orderBy: [
        { unlocked: 'desc' }, // Show unlocked first
        { badge: { priority: 'desc' } }, // Then by priority
        { badge: { createdAt: 'asc' } }, // Then by creation date
      ],
      take,
    });
  }

  async findRemainingPreviewBadges(
    where: Prisma.UserBadgeWhereInput,
    take: number,
  ): Promise<UserBadgeWithBadge[]> {
    return this.prisma.userBadge.findMany({
      where,
      include: { badge: true },
      orderBy: [{ badge: { priority: 'desc' } }],
      take,
    });
  }

  async findFullBadgeList(
    where: Prisma.UserBadgeWhereInput,
  ): Promise<UserBadgeWithBadge[]> {
    return this.prisma.userBadge.findMany({
      where,
      include: {
        badge: true,
      },
      orderBy: [{ badge: { priority: 'desc' } }],
    });
  }

  async findByCompositeKey(
    userId: string,
    kidId: string | null,
    badgeId: string,
  ): Promise<UserBadgeWithBadge | null> {
    // Prisma compound key with nullable field requires type assertion
    // kidId is optional in the schema (String?) but compound key typing can be strict
    return this.prisma.userBadge.findUnique({
      where: {
        userId_kidId_badgeId: {
          userId,
          kidId: kidId as string,
          badgeId,
        },
      },
      include: { badge: true },
    });
  }

  async findByCompositeKeyForUpdate(
    key: UserBadgeCompositeKey,
    tx?: Prisma.TransactionClient,
  ): Promise<UserBadge | null> {
    const client = tx ?? this.prisma;
    return client.userBadge.findUnique({
      where: { userId_kidId_badgeId: key } as {
        userId_kidId_badgeId: {
          userId: string;
          kidId: string;
          badgeId: string;
        };
      },
    });
  }

  async updateById(
    id: string,
    data: Prisma.UserBadgeUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<UserBadge> {
    const client = tx ?? this.prisma;
    return client.userBadge.update({
      where: { id },
      data,
    });
  }

  async executeTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
