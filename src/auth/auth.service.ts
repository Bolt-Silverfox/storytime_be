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
import PrismaService from 'src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { generateToken } from 'src/utils/generete-token';
import * as crypto from 'crypto';
import { NotificationService } from 'src/notification/notification.service';
import { JwtService } from '@nestjs/jwt';

const JWT_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = 7;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // ==================== AUTH ====================
  async login(data: LoginDto): Promise<LoginResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: { profile: true, avatar: true },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!(await bcrypt.compare(data.password, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials');

    // Check if email is verified
    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
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
    // return {
    //   user: new UserDto(user),
    //   jwt: tokenData.jwt,
    //   refreshToken: tokenData.refreshToken,
    // };
  }

  async refresh(refreshToken: string): Promise<RefreshResponseDto | null> {
    const session = await this.prisma.session.findUnique({
      where: { token: this.hashToken(refreshToken) },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException('Invalid token');
    const jwt = this.generateJwt(new UserDto(session.user), session.id);

    // return { user: new UserDto(session.user), jwt };
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

    await this.sendEmailVerification(user?.email);

    const userFull = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true },
    });

    await this.sendEmailVerification(user.email);

    const tokenData = await this.createToken(user);
    // return {
    //   user: new UserDto(user),
    //   jwt: tokenData.jwt,
    //   refreshToken: tokenData.refreshToken,
    // };
    // New users will have 0 kids by default
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
    this.logger.log(
      `Email verification requested for ${email}: response ${JSON.stringify(resp)}`,
    );

    if (!resp.success) {
      throw new ServiceUnavailableException(
        'Failed to send verification email',
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

    if (!verificationToken)
      throw new NotFoundException('Invalid verification token');
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
        results.push(kid); // No change, return original
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
  async requestPasswordReset(data: RequestResetDto) {
    const { email } = data;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

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
        resetLink: `${process.env.WEB_APP_BASE_URL}/reset-password?tk=${token}`,
      },
    );

    this.logger.log(
      `Password reset requested for ${email}: response ${JSON.stringify(resp)}`,
    );
    return { message: 'Password Reset email sent' };
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
}
