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
}
