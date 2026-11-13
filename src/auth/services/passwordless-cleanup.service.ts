import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ILoginChallengeRepository,
  LOGIN_CHALLENGE_REPOSITORY,
} from '../repositories/login-challenge.repository.interface';
import {
  PASSWORDLESS_CLEANUP_BATCH,
  PASSWORDLESS_CLEANUP_GRACE_MS,
  PASSWORDLESS_CLEANUP_MAX_BATCHES,
} from './passwordless.constants';

@Injectable()
export class PasswordlessCleanupService {
  private readonly logger = new Logger(PasswordlessCleanupService.name);

  constructor(
    @Inject(LOGIN_CHALLENGE_REPOSITORY)
    private readonly challenges: ILoginChallengeRepository,
  ) {}

  @Cron('17 * * * *', { name: 'passwordlessChallengeCleanup' })
  async purgeExpired(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - PASSWORDLESS_CLEANUP_GRACE_MS);
      let removed = 0;
      for (let i = 0; i < PASSWORDLESS_CLEANUP_MAX_BATCHES; i++) {
        const count = await this.challenges.deleteExpiredBefore(
          cutoff,
          PASSWORDLESS_CLEANUP_BATCH,
        );
        removed += count;
        if (count < PASSWORDLESS_CLEANUP_BATCH) break;
      }
      if (removed > 0) {
        this.logger.log(`Purged ${removed} expired login challenges`);
      }
    } catch (error) {
      this.logger.error(
        `Login challenge cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
