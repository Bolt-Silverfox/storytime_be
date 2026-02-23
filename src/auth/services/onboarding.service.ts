import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CompleteProfileDto,
  UpdateProfileDto,
  UserDto,
  RegisterDto,
  LoginResponseDto,
} from '../dto/auth.dto';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Role,
  NotificationCategory,
  NotificationType,
  OnboardingStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  ResourceAlreadyExistsException,
  InvalidAdminSecretException,
} from '@/shared/exceptions';
import { AppEvents, UserRegisteredEvent } from '@/shared/events';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  async register(data: RegisterDto): Promise<LoginResponseDto | null> {
    const existingUser = await this.authRepository.findUserByEmail(data.email);
    if (existingUser) {
      throw new ResourceAlreadyExistsException('User', 'email', data.email);
    }

    let role: Role = Role.parent;
    if (data.role === Role.admin) {
      if (data.adminSecret !== this.configService.get<string>('ADMIN_SECRET')) {
        throw new InvalidAdminSecretException();
      }
      role = Role.admin;
    }

    const hashedPassword = await this.passwordService.hashPassword(
      data.password,
    );

    // Ensure transaction support in repository
    const user = await this.authRepository.createUser({
      name: data.fullName,
      email: data.email,
      passwordHash: hashedPassword,
      role: role.toString(),
      onboardingStatus: OnboardingStatus.account_created,
    });

    // side-effects (notification preferences, etc.) are handled by activity-log and notification-preference listeners

    // Emit user registration event
    this.eventEmitter.emit(AppEvents.USER_REGISTERED, {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      registeredAt: user.createdAt,
    } satisfies UserRegisteredEvent);

    const tokenData = await this.tokenService.createTokenPair(user);

    return {
      user: new UserDto({ ...user, numberOfKids: 0 }),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  async completeProfile(userId: string, data: CompleteProfileDto) {
    const user = await this.authRepository.findUserByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.onboardingStatus === OnboardingStatus.pin_setup) {
      throw new BadRequestException('Onboarding already completed');
    }

    if (data.learningExpectationIds && data.learningExpectationIds.length > 0) {
      const existingExpectations =
        await this.authRepository.findLearningExpectationsByIds(
          data.learningExpectationIds,
        );

      if (existingExpectations.length !== data.learningExpectationIds.length) {
        throw new BadRequestException(
          'Some selected learning expectations do not exist or are inactive',
        );
      }

      await this.authRepository.createUserLearningExpectations(
        userId,
        existingExpectations.map((exp) => exp.id),
      );
    }

    // Handle preferred categories
    if (data.preferredCategories && data.preferredCategories.length > 0) {
      await this.authRepository.updateUserPreferredCategories(
        userId,
        data.preferredCategories,
      );
    }

    const profile = await this.authRepository.updateProfile(userId, {
      language: data.language,
      languageCode: data.languageCode,
    });

    if (data.profileImageUrl) {
      let avatar = await this.authRepository.findAvatarByUrl(
        data.profileImageUrl,
      );

      if (!avatar) {
        avatar = await this.authRepository.createAvatar({
          url: data.profileImageUrl,
          name: `user_${userId}`,
          isSystemAvatar: false,
        });
      }

      await this.authRepository.updateUser(userId, { avatarId: avatar.id });
    }

    await this.authRepository.updateUser(userId, {
      onboardingStatus: OnboardingStatus.profile_setup,
    });

    const updatedUser =
      await this.authRepository.findUserByIdWithLearningExpectations(userId);
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    const numberOfKids = await this.authRepository.countKidsByParentId(userId);

    return new UserDto({
      ...updatedUser,
      numberOfKids,
      profile,
    });
  }

  async getLearningExpectations() {
    return this.authRepository.findActiveLearningExpectations();
  }

  async updateProfile(userId: string, data: UpdateProfileDto) {
    const user = await this.authRepository.findUserByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: Record<string, unknown> = {};
    if (data.country !== undefined) updateData.country = data.country;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.languageCode !== undefined)
      updateData.languageCode = data.languageCode;
    if (data.explicitContent !== undefined)
      updateData.explicitContent = data.explicitContent;
    if (data.maxScreenTimeMins !== undefined)
      updateData.maxScreenTimeMins = data.maxScreenTimeMins;

    // Update profile
    if (Object.keys(updateData).length === 0 && !user.profile) {
      return this.authRepository.createProfile(userId, { country: 'NG' });
    }

    const profile = await this.authRepository.upsertProfile(
      userId,
      updateData,
      {
        country: data.country || 'NG',
        language: data.language,
        languageCode: data.languageCode,
      },
    );

    const userWithKids =
      await this.authRepository.findUserByIdWithLearningExpectations(userId);
    if (!userWithKids) {
      throw new NotFoundException('User not found');
    }

    const numberOfKids = await this.authRepository.countKidsByParentId(userId);

    return new UserDto({
      ...userWithKids,
      numberOfKids,
      profile,
    });
  }
}
