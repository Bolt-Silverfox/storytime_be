import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  ResourceNotFoundException,
  InvalidTokenException,
  TokenExpiredException,
} from '@/shared/exceptions';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { TokenService } from './token.service';
import { generateToken } from '@/shared/utils/generate-token';
import { TokenType } from '../dto/auth.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, UserEmailVerifiedEvent } from '@/shared/events';
import { isTokenExpired } from './token-expiry';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendEmailVerification(email: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }

    const { token, expiresAt } = generateToken(24);
    const hashedToken = this.tokenService.hashToken(token);

    await this.authRepository.deleteUserTokensByType(
      user.id,
      TokenType.VERIFICATION,
    );
    await this.authRepository.createToken({
      userId: user.id,
      token: hashedToken,
      expiresAt,
      type: TokenType.VERIFICATION,
    });

    this.eventEmitter.emit('email.verification_requested', {
      userId: user.id,
      email: user.email,
      token,
    });

    this.logger.log(`Email verification requested for user ${user.id}`);
    return { message: 'Verification email sent' };
  }

  async verifyEmail(token: string) {
    const hashedToken = this.tokenService.hashToken(token);
    const verificationToken = await this.authRepository.findTokenByHashedToken(
      hashedToken,
      TokenType.VERIFICATION,
    );

    if (!verificationToken) {
      throw new InvalidTokenException('verification token');
    }

    if (isTokenExpired(verificationToken)) {
      await this.authRepository.deleteToken(verificationToken.id);
      throw new TokenExpiredException();
    }

    const verified = await this.authRepository.transaction(async (tx) => {
      if (!(await tx.consumeToken(verificationToken.id))) return false;
      await tx.markEmailVerified(verificationToken.userId);
      return true;
    });
    if (!verified) {
      throw new InvalidTokenException('verification token');
    }

    this.eventEmitter.emit(AppEvents.USER_EMAIL_VERIFIED, {
      userId: verificationToken.user.id,
      email: verificationToken.user.email,
      verifiedAt: new Date(),
    } satisfies UserEmailVerifiedEvent);

    return { message: 'Email verified successfully' };
  }
}
