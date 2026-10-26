import { Injectable } from '@nestjs/common';
import type { FxRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateFxRateInput,
  IAdminFxRateRepository,
} from './admin-fx-rate.repository.interface';

@Injectable()
export class PrismaAdminFxRateRepository implements IAdminFxRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(currency?: string): Promise<FxRate[]> {
    return this.prisma.fxRate.findMany({
      where: currency ? { currency } : undefined,
      orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  findById(id: string): Promise<FxRate | null> {
    return this.prisma.fxRate.findUnique({ where: { id } });
  }

  create(input: CreateFxRateInput): Promise<FxRate> {
    return this.prisma.fxRate.create({ data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.fxRate.delete({ where: { id } });
  }
}
