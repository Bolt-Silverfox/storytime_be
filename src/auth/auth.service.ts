import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  EmailNotVerifiedException,
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
  InvalidAdminSecretException,
} from '@/shared/exceptions';
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
} from './dto/auth.dto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  Role,
  NotificationCategory,
  NotificationType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { generateToken } from '@/utils/generate-token';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  UserRegisteredEvent,
  UserEmailVerifiedEvent,
} from '@/shared/events';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
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
      throw new InvalidCredentialsException();
    }

    if (!(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new InvalidCredentialsException();
    }

    if (!user.isEmailVerified) {
      throw new EmailNotVerifiedException();
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
      throw new InvalidTokenException('refresh token');
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
      throw new ResourceAlreadyExistsException('User', 'email', data.email);
    }

    let role: Role = Role.parent;
    if (data.role === 'admin') {
      if (data.adminSecret !== process.env.ADMIN_SECRET) {
        throw new InvalidAdminSecretException();
      }
      role = Role.admin;
    }

    const hashedPassword = await this.passwordService.hashPassword(
      data.password,
    );

    // Use transaction to ensure user creation + notification preferences are atomic
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
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

      // Seed default notification preferences inside the transaction
      // User-facing categories that should have preferences
      const userFacingCategories = [
        NotificationCategory.SUBSCRIPTION_REMINDER,
        NotificationCategory.SUBSCRIPTION_ALERT,
        NotificationCategory.NEW_STORY,
        NotificationCategory.STORY_FINISHED,
        NotificationCategory.INCOMPLETE_STORY_REMINDER,
        NotificationCategory.DAILY_LISTENING_REMINDER,
      ];
      const channels = [NotificationType.in_app, NotificationType.push];

      const preferences = userFacingCategories.flatMap((category) =>
        channels.map((type) => ({
          userId: newUser.id,
          category,
          type,
          enabled: true,
        })),
      );

      await tx.notificationPreference.createMany({
        data: preferences,
        skipDuplicates: true,
      });

      return newUser;
    });

    // Emit user registration event
    const registeredEvent: UserRegisteredEvent = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      registeredAt: user.createdAt,
    };
    this.eventEmitter.emit(AppEvents.USER_REGISTERED, registeredEvent);

    // Send email verification (outside transaction - non-critical)
    try {
      await this.sendEmailVerification(user.email);
    } catch (error) {
      this.logger.error('Email failed but user registered:', error.message);
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
      throw new ResourceNotFoundException('User');
    }

    const { token, expiresAt } = generateToken(24);

    // Use transaction to ensure old tokens are deleted and new one created atomically
    await this.prisma.$transaction(async (tx) => {
      await tx.token.deleteMany({
        where: { userId: user.id, type: TokenType.VERIFICATION },
      });

      await tx.token.create({
        data: {
          userId: user.id,
          token: this.tokenService.hashToken(token),
          expiresAt,
          type: TokenType.VERIFICATION,
        },
      });
    });

    // Emit event for email verification (handled by PasswordEventListener)
    this.eventEmitter.emit('email.verification_requested', {
      userId: user.id,
      email: user.email,
      token,
    });

    this.logger.log(`Email verification requested for user ${user.id}`);

    return { message: 'Verification email sent' };
  }

  async verifyEmail(token: string) {
    const hashedToken = this.tokenService.hashToken(token);
    const verificationToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.VERIFICATION },
      include: { user: true },
    });

    if (!verificationToken) {
      throw new InvalidTokenException('verification token');
    }

    if (verificationToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: verificationToken.id } });
      throw new TokenExpiredException();
    }

    // Use transaction to ensure user update + token deletion are atomic
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verificationToken.userId },
        data: {
          isEmailVerified: true,
          onboardingStatus: 'email_verified',
        },
      });
      await tx.token.delete({ where: { id: verificationToken.id } });
    });

    // Emit email verified event
    const verifiedEvent: UserEmailVerifiedEvent = {
      userId: verificationToken.user.id,
      email: verificationToken.user.email,
      verifiedAt: new Date(),
    };
    this.eventEmitter.emit(AppEvents.USER_EMAIL_VERIFIED, verifiedEvent);

    this.logger.log(`Email verified for user ${verificationToken.user.id}`);

    return { message: 'Email verified successfully' };
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
