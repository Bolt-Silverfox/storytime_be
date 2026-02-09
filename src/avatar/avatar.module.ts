import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarSeederService } from './avatar.seeder.service';
import { CloudinaryModule } from '../upload/cloudinary.module';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AVATAR_REPOSITORY,
  PrismaAvatarRepository,
} from './repositories';

@Module({
  imports: [CloudinaryModule, AuthModule, UploadModule, PrismaModule],
  controllers: [AvatarController],
  providers: [
    AvatarService,
    AvatarSeederService,
    {
      provide: AVATAR_REPOSITORY,
      useClass: PrismaAvatarRepository,
    },
  ],
  exports: [AvatarService, AvatarSeederService, AVATAR_REPOSITORY],
})
export class AvatarModule {}
