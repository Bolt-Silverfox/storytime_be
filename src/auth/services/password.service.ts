import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { TokenService } from './token.service';
import { generateToken } from '@/utils/generate-token';
import {
  TokenType,
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from '../dto/auth.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Request a password reset - sends reset email to user
   */
  async requestPasswordReset(
    data: RequestResetDto,
    _ip?: string,
    _userAgent?: string,
  ): Promise<{ message: string }> {
    const { email } = data;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete any existing reset tokens
    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: TokenType.PASSWORD_RESET },
    });

    // Generate new reset token (24 hour expiry)
    const { token, expiresAt } = generateToken(24);
    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: this.tokenService.hashToken(token),
        expiresAt,
        type: TokenType.PASSWORD_RESET,
      },
    });

    // Send password reset notification
    const resp = await this.notificationService.sendNotification(
      'PasswordReset',
      {
        email: user.email,
        resetToken: token,
      },
    );

    if (!resp.success) {
      throw new ServiceUnavailableException(
        resp.error || 'Failed to send password reset email',
      );
    }

    return { message: 'Password reset token sent' };
  }

  /**
   * Validate a password reset token
   */
  async validateResetToken(
    token: string,
    email: string,
    _data: ValidateResetTokenDto,
  ): Promise<{ message: string }> {
    const hashedToken = this.tokenService.hashToken(token);
    const resetToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
      include: { user: true },
    });

    if (!resetToken) {
      throw new NotFoundException('Invalid reset token');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
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
    _data: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const hashedToken = this.tokenService.hashToken(token);
    const resetToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
      include: { user: true },
    });

    if (!resetToken) {
      throw new NotFoundException('Invalid reset token');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new UnauthorizedException('Reset token has expired');
    }

    // Hash new password and update user
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashedPassword },
    });

    // Clean up: delete token and invalidate all sessions
    await this.prisma.token.delete({ where: { id: resetToken.id } });
    await this.tokenService.deleteAllUserSessions(resetToken.userId);

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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
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
    const isSameAsOld = await bcrypt.compare(data.newPassword, user.passwordHash);
    if (isSameAsOld) {
      throw new BadRequestException(
        'New password cannot be the same as old password',
      );
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 10);

    // Update password and invalidate other sessions atomically
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });

      // Delete all sessions except the current one
      await tx.session.deleteMany({
        where: {
          userId: userId,
          id: { not: currentSessionId },
        },
      });
    });

    // Notify user of password change
    await this.notificationService.sendNotification('PasswordChanged', {
      email: user.email,
      userName: user.name,
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Hash a password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}
