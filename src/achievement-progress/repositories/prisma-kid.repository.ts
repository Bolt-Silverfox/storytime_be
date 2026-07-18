import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IKidRepository,
  KidId,
  KidParentId,
} from './kid.repository.interface';

@Injectable()
export class PrismaKidRepository implements IKidRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findIdsByParent(parentId: string): Promise<KidId[]> {
    return this.prisma.kid.findMany({
      where: { parentId },
      select: { id: true },
    });
  }

  async findParentIdById(kidId: string): Promise<KidParentId | null> {
    return this.prisma.kid.findUnique({
      where: { id: kidId },
      select: { parentId: true },
    });
  }
}
