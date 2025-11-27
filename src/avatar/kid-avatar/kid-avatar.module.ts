import { Module } from '@nestjs/common';
import { KidAvatarController } from './kid-avatar.controller';
import { KidAvatarService } from './kid-avatar.service';
import { AvatarService } from '../avatar.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [KidAvatarController],
  providers: [KidAvatarService, AvatarService],
})
export class KidAvatarModule {}

