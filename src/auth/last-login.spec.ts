import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import appleSigninAuth from 'apple-signin-auth';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from './auth.service';
import { AUTH_REPOSITORY } from './repositories';
import { TokenService } from './services/token.service';
import { OAuthService } from './services/oauth.service';
import { OnboardingService } from './services/onboarding.service';
import { PasswordService } from './services/password.service';
import { EmailVerificationService } from './services/email-verification.service';
import { makeSession, makeUser } from '@/shared/testing/prisma-fixtures';

jest.mock('bcryptjs');
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest
    .fn()
    .mockImplementation(() => ({ verifyIdToken: jest.fn() })),
}));
jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: { verifyIdToken: jest.fn() },
}));

/**
 * Wiring spec: real AuthService/OAuthService/OnboardingService/TokenService on a
 * mocked repository, asserting which login paths record User.lastLoginAt and that
 * failed / rejected logins never do.
 */
describe('lastLoginAt recording across login paths', () => {
  let auth: AuthService;
  let oauth: OAuthService;
  let onboarding: OnboardingService;
  let googleClient: { verifyIdToken: jest.Mock };
  const repo = {
    findUserByEmailWithRelations: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserByGoogleId: jest.fn(),
    findUserByAppleId: jest.fn(),
    updateUserWithRelations: jest.fn(),
    createUser: jest.fn(),
    countKidsByParentId: jest.fn(),
    createSession: jest.fn(),
    findSessionByToken: jest.fn(),
    recordLastLogin: jest.fn(),
  };

  const verifiedUser = {
    ...makeUser({ passwordHash: 'h', isEmailVerified: true, googleId: 'g-1' }),
    profile: null,
    avatar: null,
    _count: { kids: 0 },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repo.createSession.mockResolvedValue(makeSession({ id: 'sess-1' }));
    repo.recordLastLogin.mockResolvedValue(undefined);
    repo.countKidsByParentId.mockResolvedValue(0);
    googleClient = { verifyIdToken: jest.fn() };
    (OAuth2Client as unknown as jest.Mock).mockImplementation(
      () => googleClient,
    );

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        OAuthService,
        OnboardingService,
        TokenService,
        { provide: AUTH_REPOSITORY, useValue: repo },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt') },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) =>
              k === 'GOOGLE_CLIENT_ID' ? 'gid' : undefined,
            ),
          },
        },
        {
          provide: PasswordService,
          useValue: { hashPassword: jest.fn().mockResolvedValue('x') },
        },
        {
          provide: EmailVerificationService,
          useValue: {
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    auth = mod.get(AuthService);
    oauth = mod.get(OAuthService);
    onboarding = mod.get(OnboardingService);
  });

  const googlePayload = (verified = true) => ({
    getPayload: () => ({
      sub: 'g-1',
      email: 'a@b.c',
      email_verified: verified,
    }),
  });

  describe('successful paths record exactly once', () => {
    it('email/password login', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(verifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await auth.login({ email: 'a@b.c', password: 'pw' });
      expect(repo.recordLastLogin).toHaveBeenCalledTimes(1);
      expect(repo.recordLastLogin).toHaveBeenCalledWith(verifiedUser.id);
    });

    it('google id_token login (existing user)', async () => {
      googleClient.verifyIdToken.mockResolvedValue(googlePayload());
      repo.findUserByGoogleId.mockResolvedValue(verifiedUser);
      await oauth.loginWithGoogleIdToken('tok');
      expect(repo.recordLastLogin).toHaveBeenCalledTimes(1);
      expect(repo.recordLastLogin).toHaveBeenCalledWith(verifiedUser.id);
    });

    it('google OAuth redirect callback (handleGoogleOAuthPayload)', async () => {
      repo.findUserByGoogleId.mockResolvedValue(verifiedUser);
      await oauth.handleGoogleOAuthPayload({
        providerId: 'g-1',
        email: 'a@b.c',
        emailVerified: true,
      } as never);
      expect(repo.recordLastLogin).toHaveBeenCalledTimes(1);
    });

    it('apple id_token login', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'ap-1',
        email: 'a@b.c',
        email_verified: 'true',
      });
      repo.findUserByAppleId.mockResolvedValue(verifiedUser);
      await oauth.loginWithAppleIdToken('tok');
      expect(repo.recordLastLogin).toHaveBeenCalledTimes(1);
    });

    it('registration (auto sign-in with a fresh session)', async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      repo.createUser.mockResolvedValue(verifiedUser);
      await onboarding.register({
        fullName: 'N',
        email: 'a@b.c',
        password: 'pw',
      });
      expect(repo.recordLastLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('never records', () => {
    it('on token refresh (same session rotated, not a new login)', async () => {
      repo.findSessionByToken.mockResolvedValue({
        ...makeSession({ id: 'sess-1' }),
        user: verifiedUser,
      });
      await auth.refresh('refresh-token');
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });

    it('on unknown email', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(null);
      await expect(
        auth.login({ email: 'a@b.c', password: 'pw' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });

    it('on wrong password', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(verifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        auth.login({ email: 'a@b.c', password: 'bad' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });

    it('on unverified email (password login)', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue({
        ...verifiedUser,
        isEmailVerified: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        auth.login({ email: 'a@b.c', password: 'pw' }),
      ).rejects.toThrow('Email not verified');
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });

    it('on unverified email (google)', async () => {
      googleClient.verifyIdToken.mockResolvedValue(googlePayload(false));
      repo.findUserByGoogleId.mockResolvedValue({
        ...verifiedUser,
        isEmailVerified: false,
      });
      await expect(oauth.loginWithGoogleIdToken('tok')).rejects.toThrow(
        'Email not verified',
      );
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });

    it('when session creation fails', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(verifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repo.createSession.mockRejectedValue(new Error('db down'));
      await expect(
        auth.login({ email: 'a@b.c', password: 'pw' }),
      ).rejects.toThrow('db down');
      expect(repo.recordLastLogin).not.toHaveBeenCalled();
    });
  });

  describe('best-effort write', () => {
    it('login still succeeds when the lastLoginAt write rejects', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(verifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repo.recordLastLogin.mockRejectedValue(new Error('write failed'));
      const res = await auth.login({ email: 'a@b.c', password: 'pw' });
      expect(res?.jwt).toBe('jwt');
      await new Promise((r) => setImmediate(r));
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('login still succeeds when the write throws synchronously', async () => {
      repo.findUserByEmailWithRelations.mockResolvedValue(verifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      repo.recordLastLogin.mockImplementation(() => {
        throw new Error('sync boom');
      });
      const res = await auth.login({ email: 'a@b.c', password: 'pw' });
      expect(res?.refreshToken).toEqual(expect.any(String));
    });
  });
});
