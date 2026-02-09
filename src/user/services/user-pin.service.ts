import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { hashPin, verifyPinHash } from '../utils/pin.util';

@Injectable()
export class UserPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin))
      throw new BadRequestException('PIN must be exactly 6 digits');

    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.onboardingStatus !== 'profile_setup') {
      throw new BadRequestException(
        'Complete profile setup before setting PIN',
      );
    }

    const hash = await hashPin(pin);

    await this.prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: { pinHash: hash, onboardingStatus: 'pin_setup' },
    });

    return { success: true, message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user?.pinHash) throw new BadRequestException('No PIN is set');

    const match = await verifyPinHash(pin, user.pinHash);
    if (!match) throw new BadRequestException('Incorrect PIN');

    return { success: true, message: 'PIN verified successfully' };
  }

  // ----------------------------------------------------------
  // PIN RESET VIA OTP (EMAIL)
  // ----------------------------------------------------------

  async requestPinResetOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Delete any existing PIN reset tokens for this user
    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: 'pin_reset' },
    });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // OTP expires in 1 hour
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Hash the OTP before storing
    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: hashedOtp,
        expiresAt,
        type: 'pin_reset',
      },
    });

    // Send OTP via email using notification service
    const resp = await this.notificationService.sendNotification('PinReset', {
      email: user.email,
      otp,
      userName: user.name,
    });

    if (!resp.success) {
      throw new ServiceUnavailableException(
        resp.error || 'Failed to send pin reset email',
      );
    }

    return { message: 'Pin reset token sent' };
  }

  async validatePinResetOtp(userId: string, otp: string) {
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be exactly 6 digits');
    }

    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    const resetToken = await this.prisma.token.findFirst({
      where: {
        userId,
        token: hashedOtp,
        type: 'pin_reset',
      },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid OTP');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    return { success: true, message: 'Valid OTP' };
  }

  async resetPinWithOtp(userId: string, otp: string, newPin: string) {
    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      throw new BadRequestException('OTP must be exactly 6 digits');
    }

    // Validate PIN format
    if (!/^\d{6}$/.test(newPin)) {
      throw new BadRequestException('PIN must be exactly 6 digits');
    }

    const crypto = await import('crypto');
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    // Verify OTP
    const resetToken = await this.prisma.token.findFirst({
      where: {
        userId,
        token: hashedOtp,
        type: 'pin_reset',
      },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid OTP');
    }

    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Check if new PIN is same as old PIN (using bcrypt)
    if (user.pinHash) {
      const isSameAsOld = await verifyPinHash(newPin, user.pinHash);
      if (isSameAsOld) {
        throw new BadRequestException('New PIN cannot be the same as old PIN');
      }
    }

    // Hash and save new PIN using bcrypt
    const pinHash = await hashPin(newPin);

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    // Delete the used OTP token
    await this.prisma.token.delete({ where: { id: resetToken.id } });

    return { success: true, message: 'PIN has been reset successfully' };
  }
}
