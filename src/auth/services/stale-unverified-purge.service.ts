import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaStaleUnverifiedRepository } from '../repositories/prisma-stale-unverified.repository';

export const STALE_UNVERIFIED_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const STALE_UNVERIFIED_BATCH = 500;
export const STALE_UNVERIFIED_MAX_BATCHES = 20;

@Injectable()
export class StaleUnverifiedPurgeService {
  private readonly logger = new Logger(StaleUnverifiedPurgeService.name);

  constructor(
    private readonly accounts: PrismaStaleUnverifiedRepository,
    private readonly configService: ConfigService,
  ) {}

  @Cron('43 3 * * *', { name: 'staleUnverifiedPurge' })
  async purge(): Promise<void> {
    const mode = this.configService.get<string>('STALE_UNVERIFIED_PURGE');
    if (mode !== 'dry-run' && mode !== 'on') return;

    try {
      const cutoff = new Date(Date.now() - STALE_UNVERIFIED_AGE_MS);
      if (mode === 'dry-run') {
        const count = await this.accounts.countEligible(cutoff);
        this.logger.log(
          `Stale unverified purge (dry-run): ${count} accounts would be deleted`,
        );
        return;
      }

      let removed = 0;
      for (let i = 0; i < STALE_UNVERIFIED_MAX_BATCHES; i++) {
        const ids = await this.accounts.findEligibleIds(
          cutoff,
          STALE_UNVERIFIED_BATCH,
        );
        if (ids.length === 0) break;
        removed += await this.accounts.deleteEligibleByIds(ids, cutoff);
        if (ids.length < STALE_UNVERIFIED_BATCH) break;
      }
      this.logger.log(`Stale unverified purge: deleted ${removed} accounts`);
    } catch (error) {
      this.logger.error(
        `Stale unverified purge failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
