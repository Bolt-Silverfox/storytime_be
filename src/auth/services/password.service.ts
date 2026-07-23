import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { TokenService } from './token.service';
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
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly tokenService: TokenService,
  ) {}

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
    const hashedToken = this.tokenService.hashToken(token);
    const resetToken = await this.authRepository.findTokenByHashedToken(
      hashedToken,
      TokenType.PASSWORD_RESET,
    );

    if (!resetToken) {
      throw new NotFoundException('Invalid reset token');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.authRepository.deleteToken(resetToken.id);
      throw new UnauthorizedException('Reset token has expired');
    }

    if (resetToken.user.email !== email) {
      throw new UnauthorizedException('Invalid reset token');
    }

    return { message: 'Valid reset token' };
  }

  /**
   * Reset password using a reset token
   */

  async resetPassword(
    token: string,
    email: string,
    newPassword: string,
    data: ResetPasswordDto, // eslint-disable-line @typescript-eslint/no-unused-vars
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const hashedToken = this.tokenService.hashToken(token);
    const resetToken = await this.authRepository.findTokenByHashedToken(
      hashedToken,
      TokenType.PASSWORD_RESET,
    );

    if (!resetToken) {
      throw new NotFoundException('Invalid reset token');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.authRepository.deleteToken(resetToken.id);
      throw new UnauthorizedException('Reset token has expired');
    }

    // Hash new password and update user
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.authRepository.updateUser(resetToken.userId, {
      passwordHash: hashedPassword,
    });

    // Clean up: delete token and invalidate all sessions
    await this.authRepository.deleteToken(resetToken.id);
    await this.authRepository.deleteAllUserSessions(resetToken.userId);

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
