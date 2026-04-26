import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { UploadModule } from '@/upload/upload.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    NotificationModule,
    PrismaModule,
    UploadModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
