import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationModule } from 'src/notification/notification.module';
import { AuthSessionGuard } from './auth.guard';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthStrategy } from './strategies/google-oauth.strategy';

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

    NotificationModule,
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    PrismaService,
    AuthSessionGuard,
    GoogleStrategy,
    GoogleAuthGuard,
    GoogleOAuthStrategy,
  ],

  exports: [AuthService, JwtModule, PassportModule, AuthSessionGuard],
})
export class AuthModule {}
