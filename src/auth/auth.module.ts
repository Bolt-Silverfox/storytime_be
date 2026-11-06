import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthV2Controller } from './auth-v2.controller';
import { VerifyFirstService } from './services/verify-first.service';
import { StaleUnverifiedPurgeService } from './services/stale-unverified-purge.service';
import { PrismaStaleUnverifiedRepository } from './repositories/prisma-stale-unverified.repository';
import { RegisterV2EnabledGuard } from './guards/register-v2-enabled.guard';
import { RegisterV1DeprecationInterceptor } from './interceptors/v1-deprecation.interceptor';
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
import { AccountLinkingService } from './services/account-linking.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AUTH_REPOSITORY, PrismaAuthRepository } from './repositories';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationModule,
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

  controllers: [AuthController, AuthV2Controller],

  providers: [
    AuthService,
    TokenService,
    PasswordService,
    OAuthService,
    OnboardingService,
    AccountLinkingService,
    GoogleStrategy,
    GoogleAuthGuard,
    GoogleOAuthStrategy,
    EmailVerificationService,
    VerifyFirstService,
    StaleUnverifiedPurgeService,
    PrismaStaleUnverifiedRepository,
    RegisterV2EnabledGuard,
    RegisterV1DeprecationInterceptor,
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
    AccountLinkingService,
    JwtModule,
    PassportModule,
    AUTH_REPOSITORY,
    EmailVerificationService,
    VerifyFirstService,
  ],
})
export class AuthModule {}
