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
import * as bcrypt from 'bcryptjs';
import { generateToken } from '@/utils/generate-token';
import { GoogleOAuthProfile } from '@/shared/types';
import * as crypto from 'crypto';
import { NotificationService } from '@/notification/notification.service';
import { OAuth2Client } from 'google-auth-library';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import appleSigninAuth from 'apple-signin-auth';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

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

    let role = 'parent';
    if (data.role === 'admin') {
      if (data.adminSecret !== process.env.ADMIN_SECRET) {
        throw new ForbiddenException('Invalid admin secret');
      }
      role = 'admin';
    }

    const hashedPassword = await this.passwordService.hashPassword(
      data.password,
    );

    const user = await this.prisma.user.create({
      data: {
        name: data.fullName,
        email: data.email,
        passwordHash: hashedPassword,
        role: role as any,
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

  // ==================== GOOGLE OAUTH ====================

  async loginWithGoogleIdToken(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('id_token is required');
    }

    if (!this.googleClient) {
      throw new ServiceUnavailableException('Google client not configured');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      this.logger.error('Google id_token verification failed', err);
      throw new UnauthorizedException('Invalid Google id_token');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google token payload');
    }

    const googlePayload = {
      googleId: payload.sub,
      email: payload.email,
      picture: payload.picture || null,
      name:
        `${payload.given_name || ''} ${payload.family_name || ''}`.trim() ||
        payload.name ||
        null,
      emailVerified: payload.email_verified === true,
    };

    return this._upsertOrReturnUserFromOAuthPayload(googlePayload);
  }

  async handleGoogleOAuthPayload(payload: GoogleOAuthProfile) {
    return this._upsertOrReturnUserFromOAuthPayload({
      googleId: payload.providerId,
      email: payload.email,
      picture: payload.picture,
      name:
        `${payload.firstName || ''} ${payload.lastName || ''}`.trim() ||
        undefined,
      emailVerified: payload.emailVerified,
    });
  }

  // ===============================
  // APPLE AUTH
  // ===============================
  async loginWithAppleIdToken(
    idToken: string,
    firstName?: string,
    lastName?: string,
  ) {
    if (!idToken) {
      throw new BadRequestException('id_token is required');
    }

    try {
      const {
        sub: appleId,
        email,
        email_verified,
      } = await appleSigninAuth.verifyIdToken(idToken, {
        audience: [process.env.APPLE_CLIENT_ID, process.env.APPLE_SERVICE_ID],
        nonce: 'NONCE',
        ignoreExpiration: false,
      });

      const name =
        firstName && lastName ? `${firstName} ${lastName}` : undefined;

      return this._upsertOrReturnUserFromOAuthPayload({
        appleId,
        email,
        emailVerified: email_verified === 'true' || email_verified === true,
        name,
      });
    } catch (err) {
      this.logger.error('Apple id_token verification failed', err);
      throw new UnauthorizedException('Invalid Apple id_token');
    }
  }

  // ====================================================
  // INTERNAL: Unified OAuth upsert logic
  // ====================================================
  private async _upsertOrReturnUserFromOAuthPayload(payload: {
    googleId?: string;
    appleId?: string;
    email: string;
    picture?: string | null;
    name?: string | null;
    emailVerified?: boolean;
  }) {
    const { googleId, appleId, email, picture, name, emailVerified } = payload;

    let user = null;

    // 1. Try find by googleId or appleId
    if (googleId) {
      user = await this.prisma.user.findFirst({
        where: { googleId },
        include: { profile: true, avatar: true },
      });
    } else if (appleId) {
      user = await this.prisma.user.findFirst({
        where: { appleId },
        include: { profile: true, avatar: true },
      });
    }

    // 2. Try find by email
    if (!user) {
      const existing = await this.prisma.user.findUnique({ where: { email } });

      if (existing) {
        user = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            isEmailVerified: emailVerified ? true : existing.isEmailVerified,
            googleId: googleId || existing.googleId,
            appleId: appleId || existing.appleId,
          },
          include: { profile: true, avatar: true },
        });
      }
    }

    // 3. Create new user
    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword =
        await this.passwordService.hashPassword(randomPassword);

      user = await this.prisma.user.create({
        data: {
          name: name || email || 'User',
          email,
          passwordHash: hashedPassword,
          isEmailVerified: emailVerified === true,
          googleId: googleId || null,
          appleId: appleId || null,
          role: 'parent',
          profile: {
            create: {
              country: 'NG',
            },
          },
        },
        include: { profile: true, avatar: true },
      });

      // Seed default notification preferences for new Google users
      try {
        await this.notificationService.seedDefaultPreferences(user.id);
      } catch (error) {
        this.logger.error(
          'Failed to seed notification preferences:',
          error.message,
        );
      }
    }

    // 4. Handle avatar from Google picture
    if (picture) {
      let avatar = await this.prisma.avatar.findFirst({
        where: { url: picture },
      });

      if (!avatar) {
        avatar = await this.prisma.avatar.create({
          data: {
            url: picture,
            name: `google_${googleId || user.id}`,
            isSystemAvatar: false,
          },
        });
      }

      if (user.avatarId !== avatar.id) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarId: avatar.id },
          include: { profile: true, avatar: true },
        });
      }
    }

    // 5. Must be verified
    if (!user.isEmailVerified) {
      throw new BadRequestException(
        'Email not verified. Please check your inbox.',
      );
    }

    // 6. Build response
    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: user.id },
    });

    const userDto = new UserDto({ ...user, numberOfKids });
    const tokenData = await this.tokenService.createTokenPair(userDto);

    return {
      user: userDto,
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }
}
