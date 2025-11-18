import { Module } from '@nestjs/common';
import { UserAuthService } from './UserAuth.service';
import { UserAuthController } from './userAuth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationModule } from 'src/notification/notification.module';
import PrismaService from 'src/prisma/prisma.service';
import { UserAuthRepository } from './userAuth.repository';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    NotificationModule,
  ],
  controllers: [UserAuthController],
  providers: [UserAuthService, UserAuthRepository, PrismaService],
  exports: [UserAuthService],
})
export class UserAuthModule {}
