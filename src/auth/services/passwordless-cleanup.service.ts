import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ILoginChallengeRepository,
  LOGIN_CHALLENGE_REPOSITORY,
} from '../repositories/login-challenge.repository.interface';
import { PASSWORDLESS_CLEANUP_GRACE_MS } from './passwordless.constants';

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
      const removed = await this.challenges.deleteExpiredBefore(
        new Date(Date.now() - PASSWORDLESS_CLEANUP_GRACE_MS),
      );
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
