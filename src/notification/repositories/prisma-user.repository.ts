import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IUserRepository, UserContact } from './user.repository.interface';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findContactById(userId: string): Promise<UserContact | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
  }

  async findActiveUsersBatch(params: {
    take: number;
    cursor?: string;
  }): Promise<{ id: string }[]> {
    return this.prisma.user.findMany({
      where: { isDeleted: false, isSuspended: false },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: params.take,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    });
  }
}
