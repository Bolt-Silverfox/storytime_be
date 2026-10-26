import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { FxRate } from '@prisma/client';
import {
  ADMIN_FX_RATE_REPOSITORY,
  IAdminFxRateRepository,
} from './repositories';
import { CreateFxRateDto, FxRateDto } from './dto/fx-rate.dto';
import { BASE_CURRENCY, FxRateTable } from './utils/fx-conversion.util';
import { CACHE_INVALIDATION } from '../shared/constants/cache-keys.constants';

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const toDto = (row: FxRate): FxRateDto => ({
  id: row.id,
  currency: row.currency,
  rateToUsd: row.rateToUsd.toNumber(),
  effectiveFrom: row.effectiveFrom,
  source: row.source,
  createdByAdminId: row.createdByAdminId,
  createdAt: row.createdAt,
});

/**
 * Admin-managed FX rates + the single place every revenue figure gets its rate
 * table from (getRateTable), so the dashboard, analytics, users and exports
 * can never disagree about a rate.
 */
@Injectable()
export class AdminFxRateService {
  constructor(
    @Inject(ADMIN_FX_RATE_REPOSITORY)
    private readonly repo: IAdminFxRateRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async list(currency?: string): Promise<FxRateDto[]> {
    const rows = await this.repo.list(currency?.trim().toUpperCase());
    return rows.map(toDto);
  }

  /** Loads every rate once (small table) for in-memory conversion. */
  async getRateTable(): Promise<FxRateTable> {
    const rows = await this.repo.list();
    return new FxRateTable(
      rows.map((r) => ({
        id: r.id,
        currency: r.currency,
        rateToUsd: r.rateToUsd.toNumber(),
        effectiveFrom: r.effectiveFrom,
      })),
    );
  }

  async create(dto: CreateFxRateDto, adminId: string): Promise<FxRateDto> {
    const currency = dto.currency;
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
    if (currency === BASE_CURRENCY) {
      throw new BadRequestException(
        'USD is the base currency (implicit rate 1); it cannot have a rate',
      );
    }
    if (!Number.isFinite(dto.rateToUsd) || dto.rateToUsd <= 0) {
      throw new BadRequestException('rateToUsd must be a positive number');
    }
    const effectiveFrom = dto.effectiveFrom
      ? new Date(dto.effectiveFrom)
      : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom is not a valid date');
    }
    if (effectiveFrom.getTime() > Date.now() + MAX_FUTURE_MS) {
      throw new BadRequestException(
        'effectiveFrom cannot be more than 1 day in the future',
      );
    }

    let row: FxRate;
    try {
      row = await this.repo.create({
        currency,
        rateToUsd: dto.rateToUsd,
        effectiveFrom,
        source: 'manual',
        createdByAdminId: adminId,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException(
          `A ${currency} rate already exists for that effectiveFrom`,
        );
      }
      throw e;
    }
    await this.invalidateRevenueCaches();
    return toDto(row);
  }

  async remove(id: string): Promise<FxRateDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('FX rate not found');
    await this.repo.delete(id);
    await this.invalidateRevenueCaches();
    return toDto(existing);
  }

  /** Cached dashboard figures embed converted revenue: drop them on any rate change. */
  private async invalidateRevenueCaches(): Promise<void> {
    await Promise.all(
      CACHE_INVALIDATION.REVENUE.map((key) => this.cacheManager.del(key)),
    );
  }
}
