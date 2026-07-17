import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import {
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  UserDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { TokenService } from './services/token.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_REPOSITORY, IAuthRepository } from './repositories';

/**
 * Thin orchestrator for core session/authentication flows: credential login,
 * access-token refresh, and session logout.
 *
 * Data access is delegated to {@link IAuthRepository}; other auth concerns live
 * in dedicated services (OAuthService, OnboardingService,
 * EmailVerificationService, PasswordService, AccountLinkingService, TokenService).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ==================== AUTHENTICATION ====================

  async login(data: LoginDto): Promise<LoginResponseDto | null> {
    // Single query: fetch user with profile, avatar, and kid count
    const user = await this.authRepository.findUserByEmailWithRelations(
      data.email,
    );

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

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'LOGIN',
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

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
}
