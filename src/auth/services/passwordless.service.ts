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
import { TakeoverTargetChangedError } from '../repositories/takeover-target-changed.error';
import { InactiveAccountError } from '../repositories/inactive-account.error';
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
  PASSWORDLESS_REFUND_RETRY_DELAYS_MS,
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
      if (ipCount > L.requestPerIp.max) throw this.tooManyRequests();
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

    const slot = await this.admitDailyAttempt(emailHash);
    if (!slot.admitted) throw this.invalid();
    const giveSlotBack = () =>
      this.refundFailedAttempt(emailHash, slot.charge, challengeId);
    const attempt = await this.challenges
      .recordAttempt(challengeId, now)
      .catch(async (error: unknown) => {
        await giveSlotBack();
        throw error;
      });
    if (!attempt) {
      await giveSlotBack();
      this.logger.warn(`Passwordless challenge not usable ${challengeId}`);
      throw this.invalid();
    }
    if (
      !this.compareHashes(this.codeHash(challengeId, code), attempt.codeHash)
    ) {
      this.logger.warn(`Passwordless wrong code for challenge ${challengeId}`);
      throw this.invalid();
    }

    await giveSlotBack();
    const reserved = await this.reserveCreationBudget(
      emailNormalized,
      ip,
    ).catch(async (error: unknown) => {
      await this.refundAttempt(challengeId);
      throw error;
    });
    const consumedEmail = await this.consumeOrRelease(
      () =>
        this.challenges
          .consumeById(challengeId, new Date())
          .catch(async (error: unknown) => {
            await this.refundAttempt(challengeId);
            throw error;
          }),
      reserved,
      ip,
    );
    return this.completeLogin(
      consumedEmail,
      challengeId,
      ip,
      guestSessionId,
      reserved,
    );
  }

  async consume(
    token: string,
    ip: string | undefined,
    guestSessionId?: string,
  ): Promise<PasswordlessLoginResult> {
    await this.enforceVerifyLimits(ip);
    const linkTokenHash = this.sha256(token);
    const pendingEmail = await this.challenges.findOpenEmailByLinkTokenHash(
      linkTokenHash,
      new Date(),
    );
    if (!pendingEmail) throw this.invalid();
    const reserved = await this.reserveCreationBudget(pendingEmail, ip);
    const consumedEmail = await this.consumeOrRelease(
      () => this.challenges.consumeByLinkTokenHash(linkTokenHash, new Date()),
      reserved,
      ip,
    );
    return this.completeLogin(
      consumedEmail,
      undefined,
      ip,
      guestSessionId,
      reserved,
    );
  }

  private async consumeOrRelease(
    consume: () => Promise<string | null>,
    reserved: boolean,
    ip: string | undefined,
  ): Promise<string> {
    let email: string | null;
    try {
      email = await consume();
    } catch (error) {
      if (reserved) await this.releaseCreationBudget(ip);
      throw error;
    }
    if (!email) {
      if (reserved) await this.releaseCreationBudget(ip);
      throw this.invalid();
    }
    return email;
  }

  private async completeLogin(
    emailNormalized: string,
    challengeId: string | undefined,
    ip: string | undefined,
    guestSessionId: string | undefined,
    creationReserved: boolean,
  ): Promise<PasswordlessLoginResult> {
    const refuseInactive = (): never => {
      this.logger.warn(
        `Passwordless login refused for inactive account (challenge ${challengeId ?? 'link'})`,
      );
      throw this.invalid();
    };
    const refuseMovedAccount = (error: unknown): never => {
      if (error instanceof InactiveAccountError) return refuseInactive();
      if (error instanceof TakeoverTargetChangedError) {
        this.logger.warn(
          `Passwordless login refused for account whose email changed (challenge ${challengeId ?? 'link'})`,
        );
        throw this.invalid();
      }
      throw error;
    };
    const { user, isNewUser, newlyVerified } = await this.findOrCreateUser(
      emailNormalized,
      ip,
      creationReserved,
    ).catch((error: unknown) => {
      if (error instanceof AmbiguousEmailAccountError) {
        this.logger.warn(
          `Passwordless login refused for ambiguous email match (challenge ${challengeId ?? 'link'})`,
        );
        throw this.invalid();
      }
      return refuseMovedAccount(error);
    });
    if (user.isSuspended || user.isDeleted) refuseInactive();
    if (!user.isEmailVerified) {
      this.logger.warn(
        `Passwordless login refused for unverified account (challenge ${challengeId ?? 'link'})`,
      );
      throw this.invalid();
    }

    const numberOfKids = await this.authRepository.countKidsByParentId(user.id);
    const userDto = new UserDto({ ...user, numberOfKids });
    const tokenData = await this.tokenService
      .createTokenPair(userDto, { boundEmail: emailNormalized })
      .catch(refuseMovedAccount);

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
    creationReserved: boolean,
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
        beforeCreate: creationReserved
          ? undefined
          : () => this.spendCreationBudget(ip),
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

  private tooManyRequests(): HttpException {
    return new HttpException(
      'Too many requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async spendCreationBudget(ip: string | undefined): Promise<void> {
    let spent: boolean;
    try {
      spent = (await this.throttle.admit(this.creationBudgets(ip))) === 0;
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again.',
      );
    }
    if (spent) {
      this.logger.warn('Passwordless account creation budget spent');
      throw this.tooManyRequests();
    }
  }

  private async reserveCreationBudget(
    email: string,
    ip: string | undefined,
  ): Promise<boolean> {
    const existing = await this.authRepository
      .findUserByEmailInsensitive(email)
      .catch((error: unknown) => {
        if (error instanceof AmbiguousEmailAccountError) return true;
        this.logger.error('Passwordless account lookup failed');
        throw new ServiceUnavailableException(
          'Service temporarily unavailable. Please try again.',
        );
      });
    if (existing) return false;
    await this.spendCreationBudget(ip);
    return true;
  }

  private async releaseCreationBudget(ip: string | undefined): Promise<void> {
    await Promise.all(
      this.creationBudgets(ip).map((b) =>
        this.throttle.release(b.key, b.windowMs),
      ),
    ).catch(() => {
      this.logger.error('Passwordless throttle store unavailable');
    });
  }

  private async enforceVerifyLimits(
    ip: string | undefined,
    emailHash?: string,
  ): Promise<void> {
    const L = PASSWORDLESS_LIMITS;
    const ipCount = await this.countOrFailOpen(
      `pwl:ver:ip:${this.hmac(ip ?? 'unknown')}`,
      L.verifyPerIp.windowMs,
    );
    if (ipCount > L.verifyPerIp.max) throw this.tooManyRequests();
    if (!emailHash) return;
    const emailCount = await this.countOrFailOpen(
      `pwl:ver:email:${emailHash}`,
      L.verifyPerEmail.windowMs,
    );
    if (emailCount > L.verifyPerEmail.max) throw this.tooManyRequests();
  }

  private async countOrFailOpen(
    key: string,
    windowMs: number,
  ): Promise<number> {
    try {
      return await this.throttle.hit(key, windowMs);
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      return 0;
    }
  }

  private failedAttemptKey(emailHash: string): string {
    return `pwl:fail:charges:${emailHash}`;
  }

  private async admitDailyAttempt(
    emailHash: string,
  ): Promise<{ admitted: boolean; charge?: string }> {
    const cap = PASSWORDLESS_LIMITS.failedVerifyPerEmailDay;
    const charge = crypto.randomUUID();
    try {
      const attempts = await this.throttle.charge(
        { key: this.failedAttemptKey(emailHash), ...cap },
        charge,
      );
      if (attempts === cap.max) {
        this.logger.error(
          `Passwordless failed-attempt cap reached for email hash ${emailHash.slice(0, 12)}`,
        );
      }
      return attempts > 0 ? { admitted: true, charge } : { admitted: false };
    } catch {
      this.logger.error('Passwordless throttle store unavailable');
      return { admitted: true, charge };
    }
  }

  private async refundFailedAttempt(
    emailHash: string,
    charge: string | undefined,
    challengeId: string,
  ): Promise<void> {
    if (!charge) return;
    const refund = () =>
      this.throttle.refund(this.failedAttemptKey(emailHash), charge).then(
        () => true,
        () => false,
      );
    if (await refund()) return;
    void (async () => {
      for (const delayMs of PASSWORDLESS_REFUND_RETRY_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (await refund()) return;
      }
      this.logger.error(
        `Passwordless failed-attempt refund abandoned for challenge ${challengeId}`,
      );
    })();
  }

  private async refundAttempt(challengeId: string): Promise<void> {
    await this.challenges.refundAttempt(challengeId).catch(() => {
      this.logger.error(`Passwordless attempt refund failed ${challengeId}`);
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
