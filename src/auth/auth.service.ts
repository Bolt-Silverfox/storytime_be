import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import appleSigninAuth from 'apple-signin-auth';
import { Role, OnboardingStatus, Prisma } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
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

    let role: Role = Role.parent;
    if (data.role === Role.admin) {
      if (data.adminSecret !== this.configService.get<string>('ADMIN_SECRET')) {
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
        onboardingStatus: OnboardingStatus.account_created,
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
        onboardingStatus: OnboardingStatus.email_verified,
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
    if (user.onboardingStatus === OnboardingStatus.pin_setup) {
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
      data: { onboardingStatus: OnboardingStatus.profile_setup },
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

    // Build array of valid audience values (all platforms)
    const validAudiences = [
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_WEB_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
    ].filter((id): id is string => Boolean(id));

    if (validAudiences.length === 0) {
      throw new ServiceUnavailableException('No Google client IDs configured');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: validAudiences,
      });
    } catch (err) {
      this.logger.error('Google id_token verification failed');
      this.logger.error(`Error: ${err.message}`);

      // Decode token to show actual audience for debugging
      try {
        const decoded = JSON.parse(
          Buffer.from(idToken.split('.')[1], 'base64').toString(),
        );
        this.logger.error(`Token audience (aud): ${decoded.aud}`);
        this.logger.error(
          `Valid audiences configured: ${validAudiences.join(', ')}`,
        );
      } catch {
        // Ignore decode errors
      }

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
        audience: [
          this.configService.get<string>('APPLE_CLIENT_ID'),
          this.configService.get<string>('APPLE_SERVICE_ID'),
        ],
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
  // LINKED ACCOUNTS
  // ====================================================

  async getLinkedAccounts(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        googleId: true,
        appleId: true,
        passwordHash: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const accounts: {
      provider: string;
      email: string | null;
      linkedAt: string | null;
    }[] = [];

    // Email is considered linked if user has a real password (not a random OAuth-generated one)
    // We detect this by checking if passwordHash exists (all users have one, but OAuth users got random ones)
    // For simplicity, email provider is always shown if user has an email
    accounts.push({ provider: 'email', email: user.email, linkedAt: null });

    if (user.googleId) {
      accounts.push({ provider: 'google', email: user.email, linkedAt: null });
    }

    if (user.appleId) {
      accounts.push({ provider: 'apple', email: user.email, linkedAt: null });
    }

    return {
      success: true,
      message: 'Linked accounts retrieved',
      statusCode: 200,
      data: accounts,
    };
  }

  async linkGoogle(userId: string, idToken: string) {
    if (!this.googleClient) {
      throw new ServiceUnavailableException('Google client not configured');
    }

    const clientIds = [
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
    ].filter(Boolean);

    if (clientIds.length === 0) {
      throw new ServiceUnavailableException('No Google client IDs configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientIds,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google id_token');
    }

    if (!payload || !payload.sub) {
      throw new BadRequestException('Invalid Google ID token');
    }

    const googleId = payload.sub;

    // Atomic link: updateMany with `googleId: null` guard ensures we only write
    // if the field is unset. The DB unique index catches cross-user conflicts (P2002).
    let updated: { count: number };
    try {
      updated = await this.prisma.user.updateMany({
        where: { id: userId, googleId: null },
        data: { googleId },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Google account is already linked to another user.',
        );
      }
      throw err;
    }
    if (updated.count === 0) {
      // Either user does not exist or googleId is already set
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      throw new BadRequestException('Google account is already linked.');
    }

    return {
      success: true,
      message: 'Google account linked successfully',
      statusCode: 200,
      data: null,
    };
  }

  async linkApple(userId: string, idToken: string) {
    const APPLE_CLIENT_ID = this.configService.get<string>('APPLE_CLIENT_ID');
    const APPLE_SERVICE_ID = this.configService.get<string>('APPLE_SERVICE_ID');
    const audiences = [APPLE_CLIENT_ID, APPLE_SERVICE_ID].filter(Boolean);

    if (audiences.length === 0) {
      throw new ServiceUnavailableException('Apple client IDs not configured');
    }

    let appleId: string | undefined;
    try {
      const verified = await appleSigninAuth.verifyIdToken(idToken, {
        audience: audiences,
        ignoreExpiration: false,
      });
      appleId = verified.sub;
    } catch {
      throw new UnauthorizedException('Invalid Apple id_token');
    }

    if (!appleId) {
      throw new BadRequestException('Invalid Apple ID token');
    }

    // Atomic link: updateMany with `appleId: null` guard ensures we only write
    // if the field is unset. The DB unique index catches cross-user conflicts (P2002).
    let updated: { count: number };
    try {
      updated = await this.prisma.user.updateMany({
        where: { id: userId, appleId: null },
        data: { appleId },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Apple account is already linked to another user.',
        );
      }
      throw err;
    }
    if (updated.count === 0) {
      // Either user does not exist or appleId is already set
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      throw new BadRequestException('Apple account is already linked.');
    }

    return {
      success: true,
      message: 'Apple account linked successfully',
      statusCode: 200,
      data: null,
    };
  }

  async unlinkProvider(userId: string, provider: string) {
    if (!['google', 'apple'].includes(provider)) {
      throw new BadRequestException(
        'Invalid provider. Must be "google" or "apple".',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleId: true, appleId: true },
    });

    if (!user) throw new NotFoundException('User not found');

    // Count linked providers. Email is counted as a fallback login method, but
    // OAuth-only users received a randomly generated passwordHash and cannot
    // actually sign in with email/password. A future `hasPassword: Boolean`
    // column would let us count email only when the user explicitly set a password.
    // For now, we require at least 2 total linked methods before allowing unlink.
    let linkedCount = 1; // email (best-effort — see note above)
    if (user.googleId) linkedCount++;
    if (user.appleId) linkedCount++;

    if (linkedCount <= 1) {
      throw new BadRequestException(
        'Cannot unlink. You must have at least one linked sign-in method.',
      );
    }

    const fieldToUnlink = provider === 'google' ? 'googleId' : 'appleId';
    if (!user[fieldToUnlink]) {
      throw new BadRequestException(`${provider} account is not linked.`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { [fieldToUnlink]: null },
    });

    return {
      success: true,
      message: `${provider} account unlinked successfully`,
      statusCode: 200,
      data: null,
    };
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

    // 2. Try find by email — if account exists but provider isn't linked, return 409
    if (!user) {
      const existing = await this.prisma.user.findUnique({ where: { email } });

      if (existing) {
        const existingProviders: string[] = ['email'];
        if (existing.googleId) existingProviders.push('google');
        if (existing.appleId) existingProviders.push('apple');

        throw new ConflictException({
          statusCode: 409,
          error: 'ACCOUNT_EXISTS_LINK_REQUIRED',
          message:
            'An account with this email already exists. Log in with your original method, then link this provider from Profile → Linked Accounts.',
          existingProviders,
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
          role: Role.parent,
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
