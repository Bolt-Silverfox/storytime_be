import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { UserDto } from '../dto/auth.dto';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  UserWithProfileAndAvatar,
} from '../repositories';
import {
  ILoginChallengeRepository,
  LOGIN_CHALLENGE_REPOSITORY,
} from '../repositories/login-challenge.repository.interface';
import {
  PASSWORDLESS_CODE_TTL_SECONDS,
  PASSWORDLESS_GLOBAL_KEY,
  PASSWORDLESS_INVALID_MESSAGE,
  PASSWORDLESS_LIMITS,
  PASSWORDLESS_RESEND_AFTER_SECONDS,
} from './passwordless.constants';
import { PasswordlessGuestMergeService } from './passwordless-guest-merge.service';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';

export interface PasswordlessRequestResult {
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface PasswordlessLoginResult {
  user: UserDto;
  jwt: string;
  refreshToken: string;
  isNewUser: boolean;
}

const DUMMY_CHALLENGE_ID = '00000000-0000-4000-8000-000000000000';

@Injectable()
export class PasswordlessService {
  private readonly logger = new Logger(PasswordlessService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(LOGIN_CHALLENGE_REPOSITORY)
    private readonly challenges: ILoginChallengeRepository,
    private readonly throttle: PasswordlessThrottleService,
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
    private readonly guestMerge: PasswordlessGuestMergeService,
  ) {}

  async request(
    email: string,
    ip: string | undefined,
  ): Promise<PasswordlessRequestResult> {
    const emailNormalized = this.normalizeEmail(email);
    const ipHash = this.hmac(ip ?? 'unknown');
    const emailHash = this.hmac(emailNormalized);
    const result: PasswordlessRequestResult = {
      message: 'If the email can receive a code, it has been sent.',
      expiresInSeconds: PASSWORDLESS_CODE_TTL_SECONDS,
      resendAfterSeconds: PASSWORDLESS_RESEND_AFTER_SECONDS,
    };

    let counts: number[];
    const L = PASSWORDLESS_LIMITS;
    try {
      counts = await Promise.all([
        this.throttle.hit(`pwl:req:ip:${ipHash}`, L.requestPerIp.windowMs),
        this.throttle.hit(
          `pwl:req:email:${emailHash}:m`,
          L.requestPerEmailBurst.windowMs,
        ),
        this.throttle.hit(
          `pwl:req:email:${emailHash}:h`,
          L.requestPerEmailHour.windowMs,
        ),
        this.throttle.hit(PASSWORDLESS_GLOBAL_KEY, L.requestGlobal.windowMs),
      ]);
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
    }
    const [ipCount, burstCount, hourCount, globalCount] = counts;

    if (ipCount > L.requestPerIp.max) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (globalCount > L.requestGlobal.max) {
      this.logger.warn('Passwordless global send ceiling reached');
      return result;
    }
    if (
      burstCount > L.requestPerEmailBurst.max ||
      hourCount > L.requestPerEmailHour.max
    ) {
      return result;
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const linkToken = crypto.randomBytes(32).toString('base64url');

    await this.challenges.replaceOpenChallenge({
      id,
      emailNormalized,
      codeHash: this.codeHash(id, code),
      linkTokenHash: this.sha256(linkToken),
      expiresAt: new Date(now.getTime() + PASSWORDLESS_CODE_TTL_SECONDS * 1000),
      requestIpHash: ipHash,
      now,
    });

    this.eventEmitter.emit('passwordless.requested', {
      challengeId: id,
      email: emailNormalized,
      code,
      linkToken,
    });
    this.logger.log(`Passwordless challenge issued ${id}`);
    return result;
  }

  async verify(
    email: string,
    code: string,
    ip: string | undefined,
    guestSessionId?: string,
  ): Promise<PasswordlessLoginResult> {
    const emailNormalized = this.normalizeEmail(email);
    await this.enforceVerifyLimits(ip, this.hmac(emailNormalized));

    const now = new Date();
    const challengeId = await this.challenges.findOpenIdByEmail(
      emailNormalized,
      now,
    );
    if (!challengeId) {
      this.compareHashes(
        this.codeHash(DUMMY_CHALLENGE_ID, code),
        this.codeHash(DUMMY_CHALLENGE_ID, '000000'),
      );
      throw this.invalid();
    }

    const attempt = await this.challenges.recordAttempt(challengeId, now);
    if (!attempt) {
      this.logger.warn(`Passwordless challenge not usable ${challengeId}`);
      throw this.invalid();
    }
    if (
      !this.compareHashes(this.codeHash(challengeId, code), attempt.codeHash)
    ) {
      this.logger.warn(`Passwordless wrong code for challenge ${challengeId}`);
      throw this.invalid();
    }

    const consumedEmail = await this.challenges.consumeById(challengeId, now);
    if (!consumedEmail) throw this.invalid();
    return this.completeLogin(consumedEmail, challengeId, guestSessionId);
  }

  async consume(
    token: string,
    ip: string | undefined,
    guestSessionId?: string,
  ): Promise<PasswordlessLoginResult> {
    await this.enforceVerifyLimits(ip);
    const consumedEmail = await this.challenges.consumeByLinkTokenHash(
      this.sha256(token),
      new Date(),
    );
    if (!consumedEmail) throw this.invalid();
    return this.completeLogin(consumedEmail, undefined, guestSessionId);
  }

  private async completeLogin(
    emailNormalized: string,
    challengeId: string | undefined,
    guestSessionId?: string,
  ): Promise<PasswordlessLoginResult> {
    const { user, isNewUser } = await this.findOrCreateUser(emailNormalized);
    if (user.isSuspended || user.isDeleted) {
      this.logger.warn(
        `Passwordless login refused for inactive account (challenge ${challengeId ?? 'link'})`,
      );
      throw this.invalid();
    }

    const numberOfKids = await this.authRepository.countKidsByParentId(user.id);
    const userDto = new UserDto({ ...user, numberOfKids });
    const tokenData = await this.tokenService.createTokenPair(userDto);

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'LOGIN',
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    if (guestSessionId) {
      try {
        await this.guestMerge.carryOver(user.id, guestSessionId, isNewUser);
      } catch (error) {
        this.logger.warn(
          `Guest carry-over skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return {
      user: userDto,
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
      isNewUser,
    };
  }

  private async findOrCreateUser(
    email: string,
  ): Promise<{ user: UserWithProfileAndAvatar; isNewUser: boolean }> {
    const run = () =>
      findOrCreateParentByVerifiedEmail(
        {
          authRepository: this.authRepository,
          passwordService: this.passwordService,
        },
        { email, emailVerified: true, onboardingStatus: 'email_verified' },
      );
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return run();
      throw error;
    }
  }

  private async enforceVerifyLimits(
    ip: string | undefined,
    emailHash?: string,
  ): Promise<void> {
    const L = PASSWORDLESS_LIMITS;
    try {
      const ipCount = await this.throttle.hit(
        `pwl:ver:ip:${this.hmac(ip ?? 'unknown')}`,
        L.verifyPerIp.windowMs,
      );
      const emailCount = emailHash
        ? await this.throttle.hit(
            `pwl:ver:email:${emailHash}`,
            L.verifyPerEmail.windowMs,
          )
        : 0;
      if (ipCount > L.verifyPerIp.max || emailCount > L.verifyPerEmail.max) {
        throw new HttpException(
          'Too many requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Passwordless throttle store unavailable');
    }
  }

  private invalid(): BadRequestException {
    return new BadRequestException(PASSWORDLESS_INVALID_MESSAGE);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private pepper(): string {
    const pepper = this.configService.get<string>('PASSWORDLESS_PEPPER');
    if (!pepper) throw new ServiceUnavailableException();
    return pepper;
  }

  private hmac(value: string): string {
    return crypto
      .createHmac('sha256', this.pepper())
      .update(value)
      .digest('hex');
  }

  private codeHash(challengeId: string, code: string): string {
    return this.hmac(`${challengeId}${code}`);
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private compareHashes(candidateHex: string, storedHex: string): boolean {
    const candidate = Buffer.from(candidateHex, 'hex');
    const stored = Buffer.from(storedHex, 'hex');
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  }
}
