import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { UploadModule } from '@/upload/upload.module';
import { USER_REPOSITORY } from './repositories';
import { PrismaUserRepository } from './repositories/prisma-user.repository';

@Module({
  imports: [AuthModule, NotificationModule, PrismaModule, UploadModule],
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [UserService, USER_REPOSITORY],
})
export class UserModule {}
