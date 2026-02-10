import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CompleteProfileDto, updateProfileDto, UserDto } from '../dto/auth.dto';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
  ) {}

  async completeProfile(userId: string, data: CompleteProfileDto) {
    const user = await this.authRepository.findUserByIdWithProfile(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.onboardingStatus === 'pin_setup') {
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
      onboardingStatus: 'profile_setup',
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

  async updateProfile(userId: string, data: updateProfileDto) {
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
