import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

  describe('registerV2', () => {
    const dto = {
      email: 'new@example.com',
      password: 'Sup3rSecret#pw',
      fullName: 'New Parent',
    };

    it('creates a marked account, mints no session and returns no tokens', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed');
      authRepository.createUser.mockResolvedValue(mockUser);

      const result = await service.registerV2(dto);

      expect(tokenService.createTokenPair).not.toHaveBeenCalled();
      expect(authRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: dto.email,
          verifyFirstRegisteredAt: expect.any(Date),
        }),
      );
      expect(result).toEqual({
        user: expect.objectContaining({ email: mockUser.email }),
        requiresEmailVerification: true,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'user.registered',
        expect.objectContaining({ userId: mockUser.id }),
      );
    });

    it('does not mark accounts created through v1 register', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed');
      authRepository.createUser.mockResolvedValue(mockUser);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'j',
        refreshToken: 'r',
      });

      const result = await service.register(dto);

      expect(authRepository.createUser).toHaveBeenCalledWith(
        expect.not.objectContaining({
          verifyFirstRegisteredAt: expect.anything(),
        }),
      );
      expect(result).toMatchObject({ jwt: 'j', refreshToken: 'r' });
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

    it('rejects a user whose email is not verified and writes nothing', async () => {
      authRepository.findUserByIdWithProfile.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
      });

      await expect(
        service.completeProfile('user-1', { language: 'English' }),
      ).rejects.toThrow(ForbiddenException);
      expect(authRepository.updateProfile).not.toHaveBeenCalled();
      expect(authRepository.upsertProfile).not.toHaveBeenCalled();
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
});
