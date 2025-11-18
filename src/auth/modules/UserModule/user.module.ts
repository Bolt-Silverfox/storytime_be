import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationModule } from 'src/notification/notification.module';
import PrismaService from 'src/prisma/prisma.service';
import { UserController } from './user.controller';
import { useContainer } from 'class-validator';
import { UserService } from './user.service';

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
  controllers: [UserController],
  providers: [UserService, PrismaService],
  exports: [UserService],
})
export class UserAuthModule {}
