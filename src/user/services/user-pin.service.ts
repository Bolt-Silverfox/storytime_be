import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { NotificationService } from '@/notification/notification.service';
import { hashPin, verifyPinHash } from '../utils/pin.util';
import {
  USER_REPOSITORY,
  IUserRepository,
  PinResetTokenRedemption,
} from '../repositories';

@Injectable()
export class UserPinService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin))
      throw new BadRequestException('PIN must be exactly 6 digits');

    const user = await this.userRepository.findUserById(userId);

    if (!user) throw new NotFoundException('User not found');
    if (user.onboardingStatus !== 'profile_setup') {
      throw new BadRequestException(
        'Complete profile setup before setting PIN',
      );
    }

    const hash = await hashPin(pin);

    await this.userRepository.updateUserSimple(userId, {
      pinHash: hash,
      onboardingStatus: 'pin_setup',
    });

    return { success: true, message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string) {
    const user = await this.userRepository.findUserById(userId);
    if (!user?.pinHash) throw new BadRequestException('No PIN is set');

    const match = await verifyPinHash(pin, user.pinHash);
    if (!match) throw new BadRequestException('Incorrect PIN');

    return { success: true, message: 'PIN verified successfully' };
  }

  // ----------------------------------------------------------
  // PIN RESET VIA OTP (EMAIL)
  // ----------------------------------------------------------

  async requestPinResetOtp(userId: string) {
    const user = await this.userRepository.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const issue = await this.userRepository.issuePinResetToken({
      userId: user.id,
      hashedToken: hashPinResetOtp(user.id, otp),
      expiresAt: new Date(Date.now() + PIN_RESET_OTP_TTL_MS),
      maxFailedAttempts: PIN_RESET_MAX_FAILED_ATTEMPTS,
    });
    if (issue === 'guess_budget_spent') {
      throw new HttpException(
        'Too many incorrect codes. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resp = await this.notificationService.sendNotification('PinReset', {
      email: user.email,
      otp,
      userName: user.name,
    });

    if (!resp.success) {
      throw new ServiceUnavailableException('Failed to send pin reset email');
    }

    return { message: 'Pin reset token sent' };
  }

  async validatePinResetOtp(userId: string, otp: string) {
    assertSixDigits(otp, 'OTP');

    const outcome = await this.userRepository.redeemPinResetToken({
      userId,
      hashedToken: hashPinResetOtp(userId, otp),
      maxFailedAttempts: PIN_RESET_MAX_FAILED_ATTEMPTS,
    });
    assertOtpAccepted(outcome);

    return { success: true, message: 'Valid OTP' };
  }

  async resetPinWithOtp(userId: string, otp: string, newPin: string) {
    assertSixDigits(otp, 'OTP');
    assertSixDigits(newPin, 'PIN');

    const user = await this.userRepository.findUserById(userId);
    if (!user) throw new NotFoundException('User not found');

    const hashedToken = hashPinResetOtp(userId, otp);
    const isSameAsOld = user.pinHash
      ? await verifyPinHash(newPin, user.pinHash)
      : false;

    if (isSameAsOld) {
      assertOtpAccepted(
        await this.userRepository.redeemPinResetToken({
          userId,
          hashedToken,
          maxFailedAttempts: PIN_RESET_MAX_FAILED_ATTEMPTS,
        }),
      );
      throw new BadRequestException('New PIN cannot be the same as old PIN');
    }

    const outcome = await this.userRepository.redeemPinResetToken({
      userId,
      hashedToken,
      maxFailedAttempts: PIN_RESET_MAX_FAILED_ATTEMPTS,
      newPinHash: await hashPin(newPin),
    });
    assertOtpAccepted(outcome);

    return { success: true, message: 'PIN has been reset successfully' };
  }
}

const PIN_RESET_OTP_TTL_MS = 60 * 60 * 1000;
const PIN_RESET_MAX_FAILED_ATTEMPTS = 5;

function hashPinResetOtp(userId: string, otp: string): string {
  return createHash('sha256').update(`${userId}:${otp}`).digest('hex');
}

function assertSixDigits(value: string, label: 'OTP' | 'PIN') {
  if (!/^\d{6}$/.test(value)) {
    throw new BadRequestException(`${label} must be exactly 6 digits`);
  }
}

function assertOtpAccepted(outcome: PinResetTokenRedemption) {
  if (outcome === 'expired') {
    throw new BadRequestException('OTP has expired. Please request a new one.');
  }
  if (outcome === 'invalid') {
    throw new BadRequestException('Invalid OTP');
  }
}
