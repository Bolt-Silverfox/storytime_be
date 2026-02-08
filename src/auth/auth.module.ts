import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationModule } from '@/notification/notification.module';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthStrategy } from './strategies/google-oauth.strategy';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { OAuthService } from './services/oauth.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ session: false }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
    }),

    forwardRef(() => NotificationModule),
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    TokenService,
    PasswordService,
    OAuthService,
    GoogleStrategy,
    GoogleAuthGuard,
    GoogleOAuthStrategy,
  ],

  exports: [AuthService, TokenService, OAuthService, JwtModule, PassportModule],
})
export class AuthModule {}
