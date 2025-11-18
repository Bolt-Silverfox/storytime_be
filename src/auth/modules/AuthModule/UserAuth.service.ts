import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { NotificationService } from 'src/notification/notification.service';
import { generateToken } from 'src/utils/generete-token';
import { TokenType } from '@prisma/client';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/loginResponse.dto';
import { RefreshResponseDto } from './dto/RefreshResponse.dto';
import { RegisterDto } from './dto/register.dto';
import { UserDto } from '../UserModule/dto/user.dto';
import { UserAuthRepository } from './userAuth.repository';

const JWT_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = 7;

@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name);

  constructor(
    private userAuthRepository: UserAuthRepository,
    private jwtService: JwtService,
    private notificationService: NotificationService,
  ) {}

  // -----------------------------
  // LOGIN
  // -----------------------------
  async login(data: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userAuthRepository.findUserByEmail(data.email);

    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email to log in');
    }

    const tokenData = await this.createToken(user);

    return {
      user: new UserDto(user),
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }

  // -----------------------------
  // REGISTER
  // -----------------------------
  async register(data: RegisterDto): Promise<LoginResponseDto> {
    const exists = await this.userAuthRepository.findUserByEmail(data.email);

    if (exists) throw new UnauthorizedException('Email already exists');

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.userAuthRepository.createUser(data, hashedPassword);

    await this.sendEmailVerification(user.email);

    return {
      user: new UserDto(user),
      jwt: '',
      refreshToken: '',
    };
  }

  // -----------------------------
  // REFRESH TOKEN
  // -----------------------------
  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    const session = await this.userAuthRepository.findSessionByToken(
      this.hashToken(refreshToken),
    );

    if (!session) throw new UnauthorizedException('Invalid token');

    const jwt = this.generateJwt(new UserDto(session.user), session.id);

    return {
      user: new UserDto(session.user),
      jwt,
    };
  }

  // -----------------------------
  // LOGOUT
  // -----------------------------
  async logout(sessionId: string): Promise<boolean> {
    const session = await this.userAuthRepository.findSessionById(sessionId);
    if (!session) return false;

    await this.userAuthRepository.deleteSession(sessionId);
    return true;
  }

  // -----------------------------
  // LOGOUT ALL DEVICES
  // -----------------------------
  async logoutAllDevices(userId: string): Promise<boolean> {
    await this.userAuthRepository.deleteManySessionsByUserId(userId);
    return true;
  }

  // -----------------------------
  // TOKEN CREATION
  // -----------------------------
  async createToken(user: UserDto) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN);

    const refreshToken = this.generateRefreshToken();

    await this.userAuthRepository.createSession(
      user.id,
      this.hashToken(refreshToken),
      expiresAt,
    );

    const jwt = this.generateJwt(user, crypto.randomUUID());
    return { jwt, refreshToken };
  }

  generateJwt(user: UserDto, sessionId: string) {
    return this.jwtService.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        authSessionId: sessionId,
      },
      { secret: process.env.SECRET, expiresIn: JWT_EXPIRES_IN },
    );
  }

  // -----------------------------
  // EMAIL VERIFICATION
  // -----------------------------
  async sendEmailVerification(email: string) {
    const user = await this.userAuthRepository.findUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    await this.userAuthRepository.deleteManyTokensByUserIdAndType(
      user.id,
      TokenType.EMAIL_VERIFICATION,
    );

    const { token, expiresAt } = generateToken(24);
    await this.userAuthRepository.createToken(
      user.id,
      this.hashToken(token),
      expiresAt,
      TokenType.EMAIL_VERIFICATION,
    );

    await this.notificationService.sendNotification('EmailVerification', {
      email,
      token,
    });

    return { message: 'Verification email sent' };
  }

  async verifyEmail(token: string) {
    const hashedToken = this.hashToken(token);

    const verification =
      await this.userAuthRepository.findTokenByHashedTokenAndType(
        hashedToken,
        TokenType.EMAIL_VERIFICATION,
      );

    if (!verification)
      throw new NotFoundException('Invalid verification token');
    if (verification.expiresAt < new Date()) {
      await this.userAuthRepository.deleteToken(verification.id);
      throw new UnauthorizedException('Token expired');
    }

    await this.userAuthRepository.updateUserEmailVerifiedStatus(
      verification.userId,
      true,
    );

    await this.userAuthRepository.deleteToken(verification.id);

    return { message: 'Email verified successfully' };
  }

  // -----------------------------
  // PASSWORD RESET
  // -----------------------------
  async requestPasswordReset(email: string) {
    const user = await this.userAuthRepository.findUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    await this.userAuthRepository.deleteManyTokensByUserIdAndType(
      user.id,
      TokenType.PASSWORD_RESET,
    );

    const { token, expiresAt } = generateToken(24);

    await this.userAuthRepository.createToken(
      user.id,
      this.hashToken(token),
      expiresAt,
      TokenType.PASSWORD_RESET,
    );

    await this.notificationService.sendNotification('PasswordReset', {
      email,
      resetLink: `${process.env.WEB_APP_BASE_URL}/reset-password?tk=${token}`,
    });

    return { message: 'Password reset email sent' };
  }

  async validateResetToken(token: string, email: string) {
    const hashedToken = this.hashToken(token);

    const reset = await this.userAuthRepository.findTokenByHashedTokenAndType(
      hashedToken,
      TokenType.PASSWORD_RESET,
    );

    if (!reset || reset.user.email !== email) {
      throw new UnauthorizedException('Invalid reset token');
    }

    if (reset.expiresAt < new Date()) {
      await this.userAuthRepository.deleteToken(reset.id);
      throw new UnauthorizedException('Reset token expired');
    }

    return { message: 'Valid reset token' };
  }

  async resetPassword(token: string, newPassword: string) {
    const hashedToken = this.hashToken(token);

    const reset = await this.userAuthRepository.findTokenByHashedTokenAndType(
      hashedToken,
      TokenType.PASSWORD_RESET,
    );

    if (!reset) throw new UnauthorizedException('Invalid reset token');
    if (reset.expiresAt < new Date()) {
      await this.userAuthRepository.deleteToken(reset.id);
      throw new UnauthorizedException('Reset token expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.userAuthRepository.updateUserPassword(
      reset.userId,
      hashedPassword,
    );

    await this.userAuthRepository.deleteToken(reset.id);
    await this.userAuthRepository.deleteManySessionsByUserId(reset.userId);

    return { message: 'Password reset successful' };
  }

  // UTILS
  generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
  }

  hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
