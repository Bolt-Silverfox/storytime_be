import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { AppEvents, UserEmailVerifiedEvent } from '@/shared/events';
import { TokenType, UserDto } from '../dto/auth.dto';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { revokePreVerificationAccess } from './verified-email-user';

export const VERIFY_FIRST_INVALID_MESSAGE = 'Invalid or expired code';
export const VERIFY_FIRST_MAX_ATTEMPTS = 5;

@Injectable()
export class VerifyFirstService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async verifyEmail(email: string, code: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user || user.isEmailVerified || user.isSuspended || user.isDeleted) {
      throw this.invalid();
    }

    const stored = await this.authRepository.findLatestUserTokenByType(
      user.id,
      TokenType.VERIFICATION,
    );
    if (!stored) throw this.invalid();

    const reserved = await this.authRepository.recordTokenAttempt(
      stored.id,
      new Date(),
      VERIFY_FIRST_MAX_ATTEMPTS,
    );
    if (!reserved || !this.matches(code, stored.token)) throw this.invalid();

    if (!(await this.authRepository.consumeToken(stored.id))) {
      throw this.invalid();
    }

    const hardening = await revokePreVerificationAccess(
      {
        authRepository: this.authRepository,
        passwordService: this.passwordService,
      },
      user.id,
      { resetPassword: user.verifyFirstRegisteredAt === null },
    );
    const verified = await this.authRepository.updateUserWithRelations(
      user.id,
      {
        ...hardening,
        isEmailVerified: true,
        onboardingStatus: OnboardingStatus.email_verified,
      },
    );

    this.eventEmitter.emit(AppEvents.USER_EMAIL_VERIFIED, {
      userId: verified.id,
      email: verified.email,
      verifiedAt: new Date(),
    } satisfies UserEmailVerifiedEvent);

    const numberOfKids = await this.authRepository.countKidsByParentId(
      verified.id,
    );
    const tokens = await this.tokenService.createTokenPair(verified);
    return {
      message: 'Email verified successfully',
      user: new UserDto({ ...verified, numberOfKids }),
      jwt: tokens.jwt,
      refreshToken: tokens.refreshToken,
    };
  }

  private matches(code: string, storedHash: string): boolean {
    const given = Buffer.from(this.tokenService.hashToken(code));
    const expected = Buffer.from(storedHash);
    return (
      given.length === expected.length &&
      crypto.timingSafeEqual(given, expected)
    );
  }

  private invalid(): BadRequestException {
    return new BadRequestException(VERIFY_FIRST_INVALID_MESSAGE);
  }
}
