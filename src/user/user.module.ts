import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserDeletionService } from './services/user-deletion.service';
import { UserPinService } from './services/user-pin.service';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { USER_REPOSITORY, PrismaUserRepository } from './repositories';

@Module({
  imports: [AuthModule, NotificationModule, PrismaModule],
  controllers: [UserController],
  providers: [
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    UserService,
    UserDeletionService,
    UserPinService,
  ],
  exports: [UserService, UserDeletionService, UserPinService],
})
export class UserModule {}
