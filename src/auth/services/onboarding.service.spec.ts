import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { Logger, NotFoundException } from '@nestjs/common';
import { renderLogCalls } from '@/shared/testing/render-log-calls';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  UserWithLearningExpectations,
  UserWithProfileAndAvatar,
} from '../repositories';
import { makeProfile, makeUser } from '@/shared/testing/prisma-fixtures';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationService } from './email-verification.service';
import { Role, OnboardingStatus } from '@prisma/client';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let emailVerificationService: jest.Mocked<EmailVerificationService>;

  // Satisfies both shapes the repository mocks return: the profile/avatar
  // variant and the learning-expectations variant.
  const mockUser: UserWithProfileAndAvatar & UserWithLearningExpectations = {
    ...makeUser({
      role: Role.parent,
      onboardingStatus: OnboardingStatus.email_verified,
    }),
    profile: makeProfile({
      language: null,
      languageCode: null,
      country: 'NG',
    }),
    avatar: null,
    learningExpectations: [],
  };

  const mockProfile = makeProfile({
    language: 'English',
    languageCode: 'en',
    country: 'NG',
  });

  beforeEach(async () => {
    const mockAuthRepository = {
      findUserByEmail: jest.fn(),
      findUserByIdWithProfile: jest.fn(),
      findUserByIdWithLearningExpectations: jest.fn(),
      findLearningExpectationsByIds: jest.fn(),
      createUserLearningExpectations: jest.fn(),
      updateUserPreferredCategories: jest.fn(),
      updateProfile: jest.fn(),
      findAvatarByUrl: jest.fn(),
      createAvatar: jest.fn(),
      updateUser: jest.fn(),
      countKidsByParentId: jest.fn(),
      findActiveLearningExpectations: jest.fn(),
      upsertProfile: jest.fn(),
      createProfile: jest.fn(),
      createUser: jest.fn(),
    };

    const mockPasswordService = {
      hashPassword: jest.fn(),
    };

    const mockTokenService = {
      createTokenPair: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockEmailVerificationService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: EmailVerificationService,
          useValue: mockEmailVerificationService,
        },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    authRepository = module.get(AUTH_REPOSITORY);
    passwordService = module.get(PasswordService);
    tokenService = module.get(TokenService);
    eventEmitter = module.get(EventEmitter2);
    emailVerificationService = module.get(EmailVerificationService);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed_password');
      authRepository.createUser.mockResolvedValue(mockUser);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.register({
        fullName: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toBeDefined();
      expect(authRepository.createUser).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('completeProfile', () => {
    it('should complete profile successfully', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(mockUser);
      authRepository.updateProfile.mockResolvedValue(mockProfile);
      authRepository.findUserByIdWithLearningExpectations.mockResolvedValue(
        mockUser,
      );
      authRepository.countKidsByParentId.mockResolvedValue(2);

      const result = await service.completeProfile('user-1', {
        language: 'English',
        languageCode: 'en',
      });

      expect(result).toBeDefined();
      expect(authRepository.updateProfile).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user does not exist', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(null);

      await expect(
        service.completeProfile('nonexistent-user', { language: 'en' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue(mockUser);
      authRepository.upsertProfile.mockResolvedValue(mockProfile);
      authRepository.findUserByIdWithLearningExpectations.mockResolvedValue(
        mockUser,
      );
      authRepository.countKidsByParentId.mockResolvedValue(2);

      const result = await service.updateProfile('user-1', {
        country: 'US',
        language: 'English',
      });

      expect(result).toBeDefined();
      expect(authRepository.upsertProfile).toHaveBeenCalled();
    });
  });
  describe('register when the verification email cannot be issued', () => {
    it('logs no part of the failure that could carry the email', async () => {
      const logged: unknown[][] = [];
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((...args: unknown[]) => {
          logged.push(args);
        });
      authRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed_password');
      authRepository.createUser.mockResolvedValue(mockUser);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });
      emailVerificationService.sendEmailVerification.mockRejectedValue(
        new Error(
          'Invalid `findUnique()` invocation: { email: "test@example.com" }',
        ),
      );

      await service.register({
        fullName: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(logged.length).toBeGreaterThan(0);
      expect(renderLogCalls(logged)).not.toContain('test@example.com');
      errorSpy.mockRestore();
    });
  });
});
