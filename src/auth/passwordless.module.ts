import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { GuestModule } from '../guest/guest.module';
import { AuthModule } from './auth.module';
import { PasswordlessController } from './passwordless.controller';
import { PasswordlessEnabledGuard } from './guards/passwordless-enabled.guard';
import { PrismaLoginChallengeRepository } from './repositories/prisma-login-challenge.repository';
import { LOGIN_CHALLENGE_REPOSITORY } from './repositories/login-challenge.repository.interface';
import { PasswordlessService } from './services/passwordless.service';
import { PasswordlessThrottleService } from './services/passwordless-throttle.service';
import { PasswordlessGuestMergeService } from './services/passwordless-guest-merge.service';
import { PasswordlessCleanupService } from './services/passwordless-cleanup.service';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, GuestModule],
  controllers: [PasswordlessController],
  providers: [
    PasswordlessService,
    PasswordlessThrottleService,
    PasswordlessGuestMergeService,
    PasswordlessCleanupService,
    PasswordlessEnabledGuard,
    {
      provide: LOGIN_CHALLENGE_REPOSITORY,
      useClass: PrismaLoginChallengeRepository,
    },
  ],
})
export class PasswordlessModule {}
