import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Inject,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@/redis/redis.service';
import { TokenService } from './token.service';
import { ResetAttemptCounter, ResetCharge } from './reset-attempt-counter';
import { isTokenExpired } from './token-expiry';
import { generateToken } from '@/shared/utils/generate-token';
import {
  TokenType,
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from '../dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, UserPasswordChangedEvent } from '@/shared/events';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  TokenWithUser,
} from '../repositories';

const RESET_MAX_FAILED_ATTEMPTS = 5;
const RESET_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const RESET_REDIS_TIMEOUT_MS = 2000;

const normalizeEmail = (email: string) => email.toLowerCase().trim();

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly attempts: ResetAttemptCounter;

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly tokenService: TokenService,
    private readonly redis: RedisService,
  ) {
    this.attempts = new ResetAttemptCounter(
      redis.client,
      RESET_ATTEMPT_WINDOW_MS,
      RESET_MAX_FAILED_ATTEMPTS,
      RESET_REDIS_TIMEOUT_MS,
    );
  }

  private resetAttemptsKey(email: string): string {
    const digest = createHash('sha256')
      .update(normalizeEmail(email))
      .digest('hex');
    return `password-reset:attempts:${digest}`;
  }

  private async countResetAttempt(email: string): Promise<ResetCharge> {
    try {
      return await this.attempts.charge(this.resetAttemptsKey(email));
    } catch (error) {
      this.logFailure('Failed to count reset attempt', error);
      throw new ServiceUnavailableException(
        'Password reset is temporarily unavailable. Try again later.',
      );
    }
  }

  private async clearResetAttempts(email: string) {
    try {
      await this.attempts.clear(this.resetAttemptsKey(email));
    } catch (error) {
      this.logFailure('Failed to clear reset attempts', error);
    }
  }

  private async refundUnlessJudged<T>(
    email: string,
    charge: ResetCharge,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof HttpException)) {
        await this.attempts
          .refund(this.resetAttemptsKey(email), charge.reservation)
          .catch((refundError: unknown) =>
            this.logFailure('Failed to refund reset attempt', refundError),
          );
      }
      throw error;
    }
  }

  private logFailure(context: string, error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    const kind =
      typeof code === 'string'
        ? code
        : error instanceof Error
          ? error.name
          : typeof error;
    this.logger.error(`${context} (${kind})`);
  }

  private async chargeTokenOwner(resetToken: TokenWithUser) {
    const charge = await this.attempts.charge(
      this.resetAttemptsKey(resetToken.user.email),
    );
    if (!charge.withinLimit) {
      await this.authRepository.deleteToken(resetToken.id);
    }
  }

  private async revokeForeignCode(token: string, email: string) {
    const presented = await this.findPresentedCode(token);
    if (!presented || this.isOwnedBy(presented, email)) return;
    const [charge, revoke] = await Promise.allSettled([
      this.attempts.charge(this.resetAttemptsKey(presented.user.email)),
      this.authRepository.deleteToken(presented.id),
    ]);
    if (charge.status === 'rejected') {
      this.logFailure('Failed to charge reset token owner', charge.reason);
    }
    if (revoke.status === 'rejected') {
      this.logFailure('Failed to revoke presented reset code', revoke.reason);
    }
  }

  private inBackground(task: Promise<void>, context: string) {
    task.catch((error: unknown) => this.logFailure(context, error));
  }

  private isOwnedBy(resetToken: TokenWithUser, email: string) {
    return normalizeEmail(resetToken.user.email) === normalizeEmail(email);
  }

  private findPresentedCode(token: string) {
    return this.authRepository.findTokenByHashedToken(
      this.tokenService.hashToken(token),
      TokenType.PASSWORD_RESET,
    );
  }

  private async reserveResetAttempt(token: string, email: string) {
    const charge = await this.countResetAttempt(email);
    if (!charge.withinLimit) {
      this.inBackground(
        this.revokeForeignCode(token, email),
        'Failed to resolve presented reset code',
      );
      throw new HttpException(
        'Too many failed reset attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return charge;
  }

  private async findOwnedLiveCode(token: string, email: string) {
    const resetToken = await this.findPresentedCode(token);

    if (!resetToken) {
      throw new NotFoundException('Invalid reset token');
    }

    if (!this.isOwnedBy(resetToken, email)) {
      this.inBackground(
        this.chargeTokenOwner(resetToken),
        'Failed to charge reset token owner',
      );
      throw new NotFoundException('Invalid reset token');
    }

    if (isTokenExpired(resetToken)) {
      await this.authRepository.deleteToken(resetToken.id);
      throw new UnauthorizedException('Reset token has expired');
    }

    return resetToken;
  }

  /**
   * Request a password reset - sends reset email to user
   */

  async requestPasswordReset(
    data: RequestResetDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const { email } = data;
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Security: alert the user when a reset is requested from an unfamiliar IP.
    // We deliberately DO NOT record the IP here — an unauthenticated reset
    // request must not be able to establish a "known" IP (that would let an
    // attacker silence future alerts for their own address). Known IPs are
    // only ever recorded after a successful, token-authenticated reset (see
    // resetPassword). Best-effort — never block the reset if this fails.
    if (ip) {
      try {
        const knownIp = await this.authRepository.findKnownUserIP(user.id, ip);
        if (!knownIp) {
          this.eventEmitter.emit('password.reset_alert', {
            userId: user.id,
            email: user.email,
            ipAddress: ip,
            userAgent: userAgent || 'Unknown Device',
            timestamp: new Date().toISOString(),
            userName: user.name || user.email.split('@')[0],
          });
        } else {
          await this.authRepository.touchUserIP(knownIp.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`IP check/alert failed: ${message}`);
        // Continue with the password reset — security alerting must not block it.
      }
    }

    // Delete any existing reset tokens
    await this.authRepository.deleteUserTokensByType(
      user.id,
      TokenType.PASSWORD_RESET,
    );

    // Generate new reset token (24 hour expiry)
    const { token, expiresAt } = generateToken(24);
    await this.authRepository.createToken({
      userId: user.id,
      token: this.tokenService.hashToken(token),
      expiresAt,
      type: TokenType.PASSWORD_RESET,
    });

    // Emit event for password reset notification (handled by PasswordEventListener)
    this.eventEmitter.emit('password.reset_requested', {
      userId: user.id,
      email: user.email,
      resetToken: token,
    });

    this.logger.log(`Password reset requested for user ${user.id}`);

    return { message: 'Password reset token sent' };
  }

  /**
   * Validate a password reset token
   */

  async validateResetToken(
    token: string,
    email: string,
    data: ValidateResetTokenDto, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<{ message: string }> {
    const charge = await this.reserveResetAttempt(token, email);
    await this.refundUnlessJudged(email, charge, () =>
      this.findOwnedLiveCode(token, email),
    );

    await this.clearResetAttempts(email);

    return { message: 'Valid reset token' };
  }

  /**
   * Reset password using a reset token
   */

  async resetPassword(
    token: string,
    email: string,
    newPassword: string,
    data: ResetPasswordDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const charge = await this.reserveResetAttempt(token, email);
    const resetToken = await this.refundUnlessJudged(
      email,
      charge,
      async () => {
        const ownedToken = await this.findOwnedLiveCode(token, email);
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await this.authRepository.transaction(async (tx) => {
          if (!(await tx.consumeToken(ownedToken.id))) {
            throw new NotFoundException('Invalid reset token');
          }
          await tx.updateUser(ownedToken.userId, {
            passwordHash: hashedPassword,
          });
          await tx.deleteAllUserSessions(ownedToken.userId);
        });
        return ownedToken;
      },
    );

    await this.clearResetAttempts(email);

    // The reset succeeded with a token delivered to the account's email, so the
    // requester has proven control of the account. Only now is it safe to trust
    // this IP as "known" and suppress future unfamiliar-IP alerts from it.
    // Best-effort — a failure here must not fail the completed reset.
    if (ip) {
      try {
        const knownIp = await this.authRepository.findKnownUserIP(
          resetToken.userId,
          ip,
        );
        if (!knownIp) {
          await this.authRepository.recordUserIP(
            resetToken.userId,
            ip,
            userAgent,
          );
        } else {
          await this.authRepository.touchUserIP(knownIp.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to record reset IP: ${message}`);
      }
    }

    return { message: 'Password has been reset successfully' };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    data: ChangePasswordDto,
    currentSessionId: string,
  ): Promise<{ message: string }> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify old password
    const isPasswordValid = await bcrypt.compare(
      data.oldPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid old password');
    }

    // Ensure new password is different
    const isSameAsOld = await bcrypt.compare(
      data.newPassword,
      user.passwordHash,
    );
    if (isSameAsOld) {
      throw new BadRequestException(
        'New password cannot be the same as old password',
      );
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 10);

    // Update password and invalidate other sessions atomically
    await this.authRepository.transaction(async (tx) => {
      await tx.updateUser(userId, { passwordHash: hashedPassword });
      await tx.deleteOtherSessions(userId, currentSessionId);
    });

    // Emit events for password changed
    // 1. Custom event for notification (backward compatibility)
    this.eventEmitter.emit('password.changed', {
      userId: user.id,
      email: user.email,
      userName: user.name,
    });

    // 2. Standardized event for analytics/logging
    const passwordChangedEvent: UserPasswordChangedEvent = {
      userId: user.id,
      changedAt: new Date(),
      sessionsInvalidated: true, // We invalidated all other sessions
    };
    this.eventEmitter.emit(
      AppEvents.USER_PASSWORD_CHANGED,
      passwordChangedEvent,
    );

    this.logger.log(`Password changed for user ${user.id}`);

    return { message: 'Password changed successfully' };
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Hash a password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}
