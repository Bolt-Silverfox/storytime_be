import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IUserRepository,
  UserPremiumCheck,
} from './user.repository.interface';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdWithSubscriptionStatus(
    userId: string,
  ): Promise<UserPremiumCheck | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        premiumAccessUntil: true,
        subscription: { select: { status: true, endsAt: true } },
      },
    });
  }
}
