import { Module } from '@nestjs/common';
import { KidAvatarController } from './kid-avatar.controller';
import { KidAvatarService } from './kid-avatar.service';
import { AvatarService } from '../avatar.service';
import { AuthModule } from '../../auth/auth.module';
import { UploadModule } from '@/upload/upload.module';

@Module({
  imports: [AuthModule, UploadModule],
  controllers: [KidAvatarController],
  providers: [KidAvatarService, AvatarService],
  exports: [KidAvatarService],
})
export class KidAvatarModule {}
