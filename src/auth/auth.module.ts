import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthStrategy } from './strategies/google-oauth.strategy';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { OAuthService } from './services/oauth.service';
import { OnboardingService } from './services/onboarding.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AUTH_REPOSITORY, PrismaAuthRepository } from './repositories';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    PassportModule.register({ session: false }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
    }),
    // EventEmitterModule is global (configured in app.module.ts)
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    TokenService,
    PasswordService,
    OAuthService,
    OnboardingService,
    GoogleStrategy,
    GoogleAuthGuard,
    GoogleOAuthStrategy,
    EmailVerificationService,
    {
      provide: AUTH_REPOSITORY,
      useClass: PrismaAuthRepository,
    },
  ],

  exports: [
    AuthService,
    TokenService,
    PasswordService,
    OAuthService,
    OnboardingService,
    JwtModule,
    PassportModule,
    AUTH_REPOSITORY,
    EmailVerificationService,
  ],
})
export class AuthModule {}
