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
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { AmbiguousEmailAccountError } from '../repositories/ambiguous-email-account.error';
import {
  ILoginChallengeRepository,
  LOGIN_CHALLENGE_REPOSITORY,
} from '../repositories/login-challenge.repository.interface';
import {
  PASSWORDLESS_CODE_TTL_SECONDS,
  PASSWORDLESS_GLOBAL_KEY,
  PASSWORDLESS_KNOWN_NETWORK_TTL_SECONDS,
  PASSWORDLESS_INVALID_MESSAGE,
  PASSWORDLESS_LIMITS,
  PASSWORDLESS_RESEND_AFTER_SECONDS,
} from './passwordless.constants';
import { PasswordlessGuestMergeService } from './passwordless-guest-merge.service';
import { PasswordlessThrottleService } from './passwordless-throttle.service';
import { withRedisTimeout } from './redis-timeout';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { canonicalIp, ipBlock } from './ip-block';
import {
  findOrCreateParentByVerifiedEmail,
  VerifiedEmailResult,
} from './verified-email-user';
import {
  AppEvents,
  UserEmailVerifiedEvent,
  UserRegisteredEvent,
} from '@/shared/events';

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

    const L = PASSWORDLESS_LIMITS;
    let sendCounters: Array<[string, number]> = [];
    try {
      const ipCount = await this.throttle.hit(
        `pwl:req:ip:${ipHash}`,
        L.requestPerIp.windowMs,
      );
      if (ipCount > L.requestPerIp.max) {
        throw new HttpException(
          'Too many requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const burstCount = await this.throttle.hit(
        `pwl:req:email:${emailHash}:m`,
        L.requestPerEmailBurst.windowMs,
      );
      const hourCount = await this.throttle.hit(
        `pwl:req:email:${emailHash}:h`,
        L.requestPerEmailHour.windowMs,
      );
      if (
        burstCount > L.requestPerEmailBurst.max ||
        hourCount > L.requestPerEmailHour.max
      ) {
        return result;
      }
      const knownNetworkKey = this.knownNetworkKey(emailHash, ip);
      const knownNetwork = (await this.throttle.peek(knownNetworkKey)) > 0;
      const dayNetworkKey = `pwl:req:email:${emailHash}:net:${this.hmac(ipBlock(ip))}:d`;
      const dayEmailKey = `pwl:req:email:${emailHash}:d`;
      const [dayNetwork, dayEmail] = await Promise.all([
        this.throttle.peek(dayNetworkKey),
        this.throttle.peek(dayEmailKey),
      ]);
      if (
        !knownNetwork &&
        (dayNetwork >= L.requestPerEmailDayPerNetwork.max ||
          dayEmail >= L.requestPerEmailDay.max)
      ) {
        this.logger.error(
          `Passwordless daily send cap hit for email hash ${emailHash.slice(0, 12)}`,
        );
        return result;
      }
      const globalCount = await this.throttle.hit(
        PASSWORDLESS_GLOBAL_KEY,
        L.requestGlobal.windowMs,
      );
      if (globalCount > L.requestGlobal.max) {
        await this.releaseGlobal();
        this.logger.error('Passwordless global send ceiling reached');
        return result;
      }
      sendCounters = [
        [dayNetworkKey, L.requestPerEmailDayPerNetwork.windowMs],
        [dayEmailKey, L.requestPerEmailDay.windowMs],
      ];
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Passwordless throttle store unavailable');
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const linkToken = crypto.randomBytes(32).toString('base64url');

    try {
      await this.challenges.replaceOpenChallenge({
        id,
        emailNormalized,
        codeHash: this.codeHash(id, code),
        linkTokenHash: this.sha256(linkToken),
        expiresAt: new Date(
          now.getTime() + PASSWORDLESS_CODE_TTL_SECONDS * 1000,
        ),
        requestIpHash: ipHash,
        now,
      });
    } catch (error) {
      await this.releaseGlobal();
      throw error;
    }

    await Promise.all(
      sendCounters.map(([key, windowMs]) => this.throttle.hit(key, windowMs)),
    ).catch(() => {
      this.logger.error('Passwordless throttle store unavailable');
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
    const emailHash = this.hmac(emailNormalized);
    await this.enforceVerifyLimits(ip, emailHash);

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
    if (!(await this.withinDailyAttemptCap(emailHash))) {
      throw this.invalid();
    }
    if (
      !this.compareHashes(this.codeHash(challengeId, code), attempt.codeHash)
    ) {
      this.logger.warn(`Passwordless wrong code for challenge ${challengeId}`);
      throw this.invalid();
    }

    await this.releaseFailedAttempt(emailHash);
    await this.assertCreationBudgetLeft(emailNormalized, ip);
    const consumedEmail = await this.challenges.consumeById(
      challengeId,
      new Date(),
    );
    if (!consumedEmail) throw this.invalid();
    return this.completeLogin(consumedEmail, challengeId, ip, guestSessionId);
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
    return this.completeLogin(consumedEmail, undefined, ip, guestSessionId);
  }

  private async completeLogin(
    emailNormalized: string,
    challengeId: string | undefined,
    ip: string | undefined,
    guestSessionId?: string,
  ): Promise<PasswordlessLoginResult> {
    const { user, isNewUser, newlyVerified } = await this.findOrCreateUser(
      emailNormalized,
      ip,
    ).catch((error: unknown) => {
      if (error instanceof AmbiguousEmailAccountError) {
        this.logger.warn(
          `Passwordless login refused for ambiguous email match (challenge ${challengeId ?? 'link'})`,
        );
        throw this.invalid();
      }
      throw error;
    });
    if (user.isSuspended || user.isDeleted) {
      this.logger.warn(
        `Passwordless login refused for inactive account (challenge ${challengeId ?? 'link'})`,
      );
      throw this.invalid();
    }

    const numberOfKids = await this.authRepository.countKidsByParentId(user.id);
    const userDto = new UserDto({ ...user, numberOfKids });
    const tokenData = await this.tokenService.createTokenPair(userDto);

    void this.throttle
      .mark(
        this.knownNetworkKey(this.hmac(emailNormalized), ip),
        PASSWORDLESS_KNOWN_NETWORK_TTL_SECONDS,
      )
      .catch(() => {
        this.logger.error('Passwordless throttle store unavailable');
      });

    if (isNewUser) {
      this.eventEmitter.emit(AppEvents.USER_REGISTERED, {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        registeredAt: user.createdAt,
      } satisfies UserRegisteredEvent);
      this.eventEmitter.emit('admin.sse.activity', {
        type: 'SIGNUP',
        userId: user.id,
        email: user.email,
        timestamp: new Date().toISOString(),
      });
      this.eventEmitter.emit('admin.sse.stats', { trigger: 'user_created' });
    } else if (newlyVerified) {
      this.eventEmitter.emit(AppEvents.USER_EMAIL_VERIFIED, {
        userId: user.id,
        email: user.email,
        verifiedAt: new Date(),
      } satisfies UserEmailVerifiedEvent);
    }

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'LOGIN',
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    if (guestSessionId) {
      try {
        await withRedisTimeout(
          this.guestMerge.carryOver(user.id, guestSessionId, isNewUser),
        );
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
    ip: string | undefined,
  ): Promise<VerifiedEmailResult> {
    return findOrCreateParentByVerifiedEmail(
      {
        authRepository: this.authRepository,
        passwordService: this.passwordService,
      },
      {
        email,
        emailVerified: true,
        onboardingStatus: 'email_verified',
        refuseInactive: true,
        matchEmailCaseInsensitively: true,
        beforeCreate: () => this.spendCreationBudget(ip),
      },
    );
  }

  private creationBudgets(ip: string | undefined) {
    const L = PASSWORDLESS_LIMITS;
    return [
      {
        key: `pwl:create:ip:${this.hmac(canonicalIp(ip))}`,
        ...L.createPerIpHour,
      },
      {
        key: `pwl:create:net:${this.hmac(ipBlock(ip))}`,
        ...L.createPerNetworkHour,
      },
    ];
  }

  private tooManyAccounts(): HttpException {
    return new HttpException(
      'Too many requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async spendCreationBudget(ip: string | undefined): Promise<void> {
    let spent: boolean;
    try {
      const counts = await Promise.all(
        this.creationBudgets(ip).map((b) =>
          this.throttle.hit(b.key, b.windowMs).then((n) => n > b.max),
        ),
      );
      spent = counts.some(Boolean);
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
    }
    if (spent) {
      this.logger.warn('Passwordless account creation budget spent');
      throw this.tooManyAccounts();
    }
  }

  private async assertCreationBudgetLeft(
    email: string,
    ip: string | undefined,
  ): Promise<void> {
    const existing = await this.authRepository
      .findUserByEmailInsensitive(email)
      .catch(() => true);
    if (existing) return;
    try {
      for (const b of this.creationBudgets(ip)) {
        if ((await this.throttle.peek(b.key)) >= b.max) {
          throw this.tooManyAccounts();
        }
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Passwordless throttle store unavailable');
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
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

  private async withinDailyAttemptCap(emailHash: string): Promise<boolean> {
    const cap = PASSWORDLESS_LIMITS.failedVerifyPerEmailDay;
    try {
      const attempts = await this.throttle.hit(
        `pwl:fail:email:${emailHash}`,
        cap.windowMs,
      );
      if (attempts === cap.max) {
        this.logger.error(
          `Passwordless failed-attempt cap reached for email hash ${emailHash.slice(0, 12)}`,
        );
      }
      return attempts <= cap.max;
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      return true;
    }
  }

  private async releaseFailedAttempt(emailHash: string): Promise<void> {
    await this.throttle
      .release(
        `pwl:fail:email:${emailHash}`,
        PASSWORDLESS_LIMITS.failedVerifyPerEmailDay.windowMs,
      )
      .catch(() => {
        this.logger.error('Passwordless throttle store unavailable');
      });
  }

  private async releaseGlobal(): Promise<void> {
    await this.throttle
      .release(
        PASSWORDLESS_GLOBAL_KEY,
        PASSWORDLESS_LIMITS.requestGlobal.windowMs,
      )
      .catch(() => {
        this.logger.error('Passwordless throttle store unavailable');
      });
  }

  private knownNetworkKey(emailHash: string, ip: string | undefined): string {
    return `pwl:known:${emailHash}:${this.hmac(ipBlock(ip))}`;
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
