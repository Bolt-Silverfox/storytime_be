import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  RegisterDto,
  TokenType,
  UserDto,
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CompleteProfileDto,
  updateProfileDto,
} from './dto/auth.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { generateToken } from '@/utils/generate-token';
import { NotificationService } from '@/notification/notification.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
  ) {}

  // ==================== AUTHENTICATION ====================

  async login(data: LoginDto): Promise<LoginResponseDto | null> {
    // Single query: fetch user with profile, avatar, and kid count
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: {
        profile: true,
        avatar: true,
        _count: { select: { kids: true } },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }

    if (!(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new BadRequestException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new BadRequestException(
        'Email not verified. Please check your inbox.',
      );
    }

    const tokenData = await this.tokenService.createTokenPair(user);

    return {
      user: new UserDto({ ...user, numberOfKids: user._count.kids }),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponseDto | null> {
    // Session query now includes user with kid count
    const session =
      await this.tokenService.findSessionByRefreshToken(refreshToken);

    if (!session) {
      throw new UnauthorizedException('Invalid token');
    }

    const jwt = this.tokenService.generateJwt(
      new UserDto(session.user),
      session.id,
    );

    return {
      user: new UserDto({
        ...session.user,
        numberOfKids: session.user._count.kids,
      }),
      jwt,
    };
  }

  async logout(sessionId: string): Promise<boolean> {
    return this.tokenService.deleteSession(sessionId);
  }

  async logoutAllDevices(userId: string): Promise<boolean> {
    return this.tokenService.deleteAllUserSessions(userId);
  }

  // ==================== REGISTRATION ====================

  async register(data: RegisterDto): Promise<LoginResponseDto | null> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    let role: Role = Role.parent;
    if (data.role === 'admin') {
      if (data.adminSecret !== process.env.ADMIN_SECRET) {
        throw new ForbiddenException('Invalid admin secret');
      }
      role = Role.admin;
    }

    const hashedPassword = await this.passwordService.hashPassword(
      data.password,
    );

    const user = await this.prisma.user.create({
      data: {
        name: data.fullName,
        email: data.email,
        passwordHash: hashedPassword,
        role,
        onboardingStatus: 'account_created',
      },
      include: {
        profile: true,
        avatar: true,
      },
    });

    try {
      await this.sendEmailVerification(user.email);
    } catch (error) {
      this.logger.error('Email failed but user registered:', error.message);
    }

    // Seed default notification preferences for the new user
    try {
      await this.notificationService.seedDefaultPreferences(user.id);
    } catch (error) {
      this.logger.error(
        'Failed to seed notification preferences:',
        error.message,
      );
    }

    const tokenData = await this.tokenService.createTokenPair(user);

    return {
      user: new UserDto({ ...user, numberOfKids: 0 }),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  // ==================== EMAIL VERIFICATION ====================

  async sendEmailVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: TokenType.VERIFICATION },
    });

    const { token, expiresAt } = generateToken(24);

    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: this.tokenService.hashToken(token),
        expiresAt,
        type: TokenType.VERIFICATION,
      },
    });

    const resp = await this.notificationService.sendNotification(
      'EmailVerification',
      { email: user.email, token },
    );

    if (!resp.success) {
      throw new ServiceUnavailableException(
        resp.error || 'Failed to send verification email',
      );
    }

    return { message: 'Verification email sent' };
  }

  async verifyEmail(token: string) {
    const hashedToken = this.tokenService.hashToken(token);
    const verificationToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.VERIFICATION },
      include: { user: true },
    });

    if (!verificationToken) {
      throw new BadRequestException('Invalid verification token');
    }

    if (verificationToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: verificationToken.id } });
      throw new UnauthorizedException('Verification token has expired');
    }

    await this.prisma.user.update({
      where: { id: verificationToken.userId },
      data: {
        isEmailVerified: true,
        onboardingStatus: 'email_verified',
      },
    });
    await this.prisma.token.delete({ where: { id: verificationToken.id } });

    return { message: 'Email verified successfully' };
  }

  // ==================== PROFILE MANAGEMENT ====================

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

  // ==================== PASSWORD OPERATIONS (Delegated) ====================

  async requestPasswordReset(
    data: RequestResetDto,
    ip?: string,
    userAgent?: string,
  ) {
    return this.passwordService.requestPasswordReset(data, ip, userAgent);
  }

  async validateResetToken(
    token: string,
    email: string,
    data: ValidateResetTokenDto,
  ) {
    return this.passwordService.validateResetToken(token, email, data);
  }

  async resetPassword(
    token: string,
    email: string,
    newPassword: string,
    data: ResetPasswordDto,
  ) {
    return this.passwordService.resetPassword(token, email, newPassword, data);
  }

  async changePassword(
    userId: string,
    data: ChangePasswordDto,
    currentSessionId: string,
  ) {
    return this.passwordService.changePassword(userId, data, currentSessionId);
  }
}
