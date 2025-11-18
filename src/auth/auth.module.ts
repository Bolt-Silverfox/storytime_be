import { Module } from '@nestjs/common';
import { UserAuthModule } from './modules/AuthModule/userAuth.module';
import { UserModule } from '@/user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import PrismaService from 'src/prisma/prisma.service';
import { NotificationModule } from 'src/notification/notification.module';
import { AuthSessionGuard } from './guards/auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default_secret',
        signOptions: { expiresIn: '1h' },
      }),
    }),
    UserAuthModule,
    UserModule,
    NotificationModule,
  ],
  providers: [PrismaService, AuthSessionGuard],
})
export class AuthModule {}
