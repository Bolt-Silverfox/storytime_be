import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  InvalidCredentialsException,
  InvalidTokenException,
  EmailNotVerifiedException,
} from '@/shared/exceptions';
import {
  LoginDto,
  LoginResponseDto,
  RefreshResponseDto,
  UserDto,
} from './dto/auth.dto';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { AUTH_REPOSITORY, IAuthRepository } from './repositories';
import { Inject } from '@nestjs/common';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
  ) { }

  // ==================== AUTHENTICATION ====================

  async login(data: LoginDto): Promise<LoginResponseDto | null> {
    const user = await this.authRepository.findUserByEmailWithRelations(
      data.email,
    );

    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!(await this.passwordService.verifyPassword(data.password, user.passwordHash))) {
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
}
