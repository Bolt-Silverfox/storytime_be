import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CompleteProfileDto, updateProfileDto, UserDto } from '../dto/auth.dto';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async completeProfile(userId: string, data: CompleteProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.onboardingStatus === 'pin_setup') {
      throw new BadRequestException('Onboarding already completed');
    }

    if (data.learningExpectationIds && data.learningExpectationIds.length > 0) {
      const existingExpectations =
        await this.prisma.learningExpectation.findMany({
          where: {
            id: { in: data.learningExpectationIds },
            isActive: true,
            isDeleted: false,
          },
        });

      if (existingExpectations.length !== data.learningExpectationIds.length) {
        throw new BadRequestException(
          'Some selected learning expectations do not exist or are inactive',
        );
      }

      await this.prisma.userLearningExpectation.createMany({
        data: existingExpectations.map((exp) => ({
          userId,
          learningExpectationId: exp.id,
        })),
        skipDuplicates: true,
      });
    }

    // Handle preferred categories
    if (data.preferredCategories && data.preferredCategories.length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          preferredCategories: {
            set: data.preferredCategories.map((id) => ({ id })),
          },
        },
      });
    }

    const profile = await this.prisma.profile.update({
      where: { userId },
      data: {
        language: data.language,
        languageCode: data.languageCode,
      },
    });

    if (data.profileImageUrl) {
      let avatar = await this.prisma.avatar.findFirst({
        where: { url: data.profileImageUrl },
      });

      if (!avatar) {
        avatar = await this.prisma.avatar.create({
          data: {
            url: data.profileImageUrl,
            name: `user_${userId}`,
            isSystemAvatar: false,
          },
        });
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarId: avatar.id },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingStatus: 'profile_setup' },
    });

    const updatedUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        avatar: true,
        learningExpectations: {
          include: {
            learningExpectation: true,
          },
        },
      },
    });
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: userId },
    });

    return new UserDto({
      ...updatedUser,
      numberOfKids,
      profile,
    });
  }

  async getLearningExpectations() {
    return this.prisma.learningExpectation.findMany({
      where: {
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async updateProfile(userId: string, data: updateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: { profile: true },
    });
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
      return this.prisma.profile.create({
        data: {
          userId,
          country: 'NG',
        },
      });
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        country: data.country || 'NG',
        language: data.language,
        languageCode: data.languageCode,
        ...updateData,
      },
    });

    const userWithKids = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        learningExpectations: {
          include: {
            learningExpectation: true,
          },
        },
      },
    });
    if (!userWithKids) {
      throw new NotFoundException('User not found');
    }

    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: userId },
    });

    return new UserDto({
      ...userWithKids,
      numberOfKids,
      profile,
    });
  }
}
