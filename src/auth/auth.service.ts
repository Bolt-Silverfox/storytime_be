import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  kidDto,
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  RegisterDto,
  TokenType,
  updateKidDto,
  updateProfileDto,
  UserDto,
  RequestResetDto,
  ValidateResetTokenDto,
  ResetPasswordDto,
} from './auth.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { generateToken } from 'src/utils/generete-token';
import * as crypto from 'crypto';
import { NotificationService } from 'src/notification/notification.service';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

const JWT_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = 7;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

  // ==================== AUTH ====================
  async login(data: LoginDto): Promise<LoginResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: { profile: true, avatar: true },
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

    const tokenData = await this.createToken(user);
    const numberOfKids = await this.prisma?.kid.count({
      where: { parentId: user.id },
    });

    return {
      user: new UserDto({ ...user, numberOfKids }),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResponseDto | null> {
    const session = await this.prisma.session.findUnique({
      where: { token: this.hashToken(refreshToken) },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException('Invalid token');
    const jwt = this.generateJwt(new UserDto(session.user), session.id);

    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: session.user.id },
    });
    return { user: new UserDto({ ...session.user, numberOfKids }), jwt };
  }

  async logout(sessionId: string): Promise<boolean> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (!session) return false;
      await this.prisma.session.delete({ where: { id: sessionId } });
      return true;
    } catch (error) {
      this.logger.error('Error during logout:', error);
      return false;
    }
  }

  async logoutAllDevices(userId: string): Promise<boolean> {
    try {
      await this.prisma.session.deleteMany({ where: { userId } });
      return true;
    } catch (error) {
      this.logger.error('Error during logout all devices:', error);
      return false;
    }
  }

  async createToken(
    user: UserDto,
  ): Promise<{ jwt: string; refreshToken: string }> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN);
    const refreshToken = this.generateRefreshToken();

    const session = await this.prisma.session.create({
      data: { userId: user.id, token: this.hashToken(refreshToken), expiresAt },
    });

    const jwt = this.generateJwt(new UserDto(user), session.id);
    return { jwt, refreshToken };
  }

  generateJwt(user: UserDto, sessionId: string): string {
    const expiresIn = 3600;
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiryTimestamp = issuedAt + expiresIn;
    try {
      return this.jwtService.sign({
        id: user.id,
        userId: user.id,
        email: user.email,
        userRole: user.role,
        expiry: expiryTimestamp,
        authSessionId: sessionId,
      });
    } catch (error: unknown) {
      if (error instanceof Error)
        throw new Error(`Error signing token: ${error.message}`);
      this.logger.log(error);
      throw new Error('Unknown error occurred while signing token');
    }
  }

  async register(data: RegisterDto): Promise<LoginResponseDto | null> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) throw new BadRequestException('Email already exists');

    const user = await this.prisma.user.create({
      data: {
        name: data.fullName,
        email: data.email,
        passwordHash: hashedPassword,
        title: data.title,
        profile: {
          create: {},
        },
      },
      include: {
        profile: true,
        avatar: true,
      },
    });

    await this.sendEmailVerification(user.email);

    const tokenData = await this.createToken(user);
    const numberOfKids = 0;

    return {
      user: new UserDto({ ...user, numberOfKids }),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  async sendEmailVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: TokenType.VERIFICATION },
    });

    const { token, expiresAt } = generateToken(24);

    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: this.hashToken(token),
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
    const hashedToken = this.hashToken(token);
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
      data: { isEmailVerified: true },
    });
    await this.prisma.token.delete({ where: { id: verificationToken.id } });

    return { message: 'Email verified successfully' };
  }

  async updateProfile(userId: string, data: updateProfileDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updateData: Partial<any> = {};
    if (data.country !== undefined) updateData.country = data.country;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.explicitContent !== undefined)
      updateData.explicitContent = data.explicitContent;
    if (data.maxScreenTimeMins !== undefined)
      updateData.maxScreenTimeMins = data.maxScreenTimeMins;

    if (Object.keys(updateData).length === 0) {
      if (!user.profile)
        return this.prisma.profile.create({ data: { userId } });
      return user.profile;
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: updateData,
      create: { userId, ...updateData },
    });

    const userWithKids = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!userWithKids) throw new NotFoundException('User not found');

    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: userId },
    });

    return new UserDto({
      ...userWithKids,
      numberOfKids,
      profile,
    });
  }

  // ==================== KIDS ====================
  async addKids(userId: string, kids: kidDto[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.$transaction(
      kids.map((kid) =>
        this.prisma.kid.create({
          data: {
            name: kid.name,
            avatarId: kid.avatarId,
            parentId: userId,
            ageRange: kid.ageRange,
          },
          include: {
            avatar: true,
          },
        }),
      ),
    );
  }

  async getKids(userId: string) {
    return await this.prisma.kid.findMany({
      where: { parentId: userId },
      include: {
        avatar: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateKids(userId: string, updates: updateKidDto[]) {
    const results = [];
    for (const update of updates) {
      const kid = await this.prisma.kid.findFirst({
        where: { id: update.id, parentId: userId },
      });
      if (!kid)
        throw new NotFoundException(
          `Kid with ID ${update.id} not found or does not belong to user`,
        );

      const updateData: any = {};
      if (update.name !== undefined) updateData.name = update.name;
      if (update.avatarId !== undefined) updateData.avatarId = update.avatarId;
      if (update.ageRange !== undefined) updateData.ageRange = update.ageRange;

      if (Object.keys(updateData).length > 0) {
        const updated = await this.prisma.kid.update({
          where: { id: update.id },
          data: updateData,
          include: {
            avatar: true,
          },
        });
        results.push(updated);
      } else {
        results.push(kid);
      }
    }
    return results;
  }

  async deleteKids(userId: string, kidIds: string[]) {
    const deleted = [];
    for (const id of kidIds) {
      const kid = await this.prisma.kid.findFirst({
        where: { id, parentId: userId },
      });
      if (!kid)
        throw new NotFoundException(
          `Kid with ID ${id} not found or does not belong to user`,
        );
      deleted.push(await this.prisma.kid.delete({ where: { id } }));
    }
    return deleted;
  }

  // ==================== PASSWORD RESET ====================
  async requestPasswordReset(
    data: RequestResetDto,
    ip?: string,
    userAgent?: string
  ) {
    const { email } = data;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    // Security: Check for new IP and send alert
    if (ip) {
      try {
        const isKnownIp = await this.prisma.userIP.findUnique({
          where: {
            userId_ipAddress: {
              userId: user.id,
              ipAddress: ip
            }
          }
        });

        if (!isKnownIp) {
          // Alert user before proceeding with password reset
          await this.notificationService.sendNotification('PasswordResetAlert', {
            email: user.email,
            ipAddress: ip,
            userAgent: userAgent || 'Unknown Device',
            timestamp: new Date().toISOString(),
            userName: user.name || user.email.split('@')[0]
          });

          // Log the new IP for future reference
          await this.prisma.userIP.create({
            data: {
              userId: user.id,
              ipAddress: ip,
              userAgent: userAgent
            }
          });
        } else {
          // Update last used timestamp for existing IP
          await this.prisma.userIP.update({
            where: { id: isKnownIp.id },
            data: { lastUsed: new Date() }
          });
        }
      } catch (error) {
        this.logger.error(`IP check/alert failed: ${error.message}`, error.stack);
        // Continue with password reset even if alert fails - security should not block user
      }
    }

    await this.prisma.token.deleteMany({
      where: { userId: user.id, type: TokenType.PASSWORD_RESET },
    });

    const { token, expiresAt } = generateToken(24);
    await this.prisma.token.create({
      data: {
        userId: user.id,
        token: this.hashToken(token),
        expiresAt,
        type: TokenType.PASSWORD_RESET,
      },
    });

    const resp = await this.notificationService.sendNotification(
      'PasswordReset',
      {
        email: user.email,
        resetToken: token,
      },
    );

    if (!resp.success) {
      throw new ServiceUnavailableException(
        resp.error || 'Failed to send password reset email',
      );
    }

    return { message: 'Password reset token sent' };
  }

  async validateResetToken(
    token: string,
    email: string,
    data: ValidateResetTokenDto,
  ) {
    const hashedToken = this.hashToken(token);
    const resetToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
      include: { user: true },
    });
    if (!resetToken) throw new NotFoundException('Invalid reset token');
    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new UnauthorizedException('Reset token has expired');
    }
    if (resetToken.user.email !== email)
      throw new UnauthorizedException('Invalid reset token');
    return { message: 'Valid reset token' };
  }

  async resetPassword(
    token: string,
    email: string,
    newPassword: string,
    data: ResetPasswordDto,
  ) {
    const hashedToken = this.hashToken(token);
    const resetToken = await this.prisma.token.findUnique({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
      include: { user: true },
    });
    if (!resetToken) throw new NotFoundException('Invalid reset token');
    if (resetToken.expiresAt < new Date()) {
      await this.prisma.token.delete({ where: { id: resetToken.id } });
      throw new UnauthorizedException('Reset token has expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashedPassword },
    });
    await this.prisma.token.delete({ where: { id: resetToken.id } });
    await this.prisma.session.deleteMany({
      where: { userId: resetToken.userId },
    });

    return { message: 'Password has been reset successfully' };
  }

  generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ===============================
  // GOOGLE AUTH 
  // ===============================

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

  const payload = ticket.getPayload() as TokenPayload | undefined;
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

  return this._upsertOrReturnUserFromGooglePayload(googlePayload);
}

  async handleGoogleOAuthPayload(payload: any) {
  return this._upsertOrReturnUserFromGooglePayload(payload);
}

  // ====================================================
  // INTERNAL: Unified Google upsert logic
  // ====================================================
  private async _upsertOrReturnUserFromGooglePayload(payload: {
  googleId?: string;
  email: string;
  picture?: string | null;
  name?: string | null;
  emailVerified?: boolean;
}) {
  const { googleId, email, picture, name, emailVerified } = payload;

  let user = null;

  // Lookup by googleId first
  if (googleId) {
    user = await this.prisma.user.findFirst({
      where: { googleId },
      include: { profile: true, avatar: true },
    });
  }

  // Lookup by email
  if (!user) {
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          isEmailVerified: emailVerified ? true : existing.isEmailVerified,
        },
        include: { profile: true, avatar: true },
      });
    }
  }

  // Create brand new user
  if (!user) {
    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    user = await this.prisma.user.create({
      data: {
        name: name || email || 'Google User',
        email,
        passwordHash: hashedPassword,
        isEmailVerified: emailVerified === true,
        role: 'parent',
        profile: { create: {} },
      },
      include: { profile: true, avatar: true },
    });
  }

  // Avatar model handling (only if picture URL provided)
  if (picture) {
    // Find existing avatar with same URL
    let avatar = await this.prisma.avatar.findFirst({
      where: { url: picture },
    });

    // Otherwise create new one
    if (!avatar) {
      avatar = await this.prisma.avatar.create({
        data: {
          url: picture,
          name: `google_${googleId || user.id}`,
          displayName: name || email,
          isSystemAvatar: false,
        },
      });
    }

    // Attach avatar to user if not already set
    if (user.avatarId !== avatar.id) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { avatarId: avatar.id },
        include: { profile: true, avatar: true },
      });

      // Otherwise create new one
      if (!avatar) {
        avatar = await this.prisma.avatar.create({
          data: {
            url: picture,
            name: `google_${googleId || user.id}`,
            isSystemAvatar: false,
          },
        });
      }

      // Attach avatar to user if not already set
      if (user.avatarId !== avatar.id) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarId: avatar.id },
          include: { profile: true, avatar: true },
        });
      }
    }
  }

    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: user.id },
    });

    if (!user.isEmailVerified) {
      throw new BadRequestException(
        'Email not verified. Please check your inbox.',
      );
    }

  const numberOfKids = await this.prisma.kid.count({
    where: { parentId: user.id },
  });

  if (!user.isEmailVerified) {
    throw new BadRequestException(
      'Email not verified. Please check your inbox.',
    );
  }

  const userDto = new UserDto({ ...user, numberOfKids });
  const tokenData = await this.createToken(userDto);

  return {
    user: userDto,
    jwt: tokenData.jwt,
    refreshToken: tokenData.refreshToken,
  };
}
}
}
