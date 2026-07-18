import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IUserRepository,
  UserPremiumAccess,
} from './user.repository.interface';
import type { Prisma } from '@prisma/client';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPremiumAccessById(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserPremiumAccess | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: { premiumAccessUntil: true },
    });
  }

  async casUpdatePremiumAccess(
    params: {
      userId: string;
      expectedPremiumAccessUntil: Date | null;
      premiumAccessUntil: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.user.updateMany({
      where: {
        id: params.userId,
        isDeleted: false,
        premiumAccessUntil: params.expectedPremiumAccessUntil,
      },
      data: { premiumAccessUntil: params.premiumAccessUntil },
    });
  }
}
