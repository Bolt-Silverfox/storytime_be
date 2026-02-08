import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserDeletionService } from './services/user-deletion.service';
import { UserPinService } from './services/user-pin.service';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [AuthModule, NotificationModule, PrismaModule],
  controllers: [UserController],
  providers: [UserService, UserDeletionService, UserPinService],
  exports: [UserService, UserDeletionService, UserPinService],
})
export class UserModule {}
