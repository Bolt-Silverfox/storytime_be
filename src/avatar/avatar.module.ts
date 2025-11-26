// src/avatar/avatar.module.ts
import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryModule } from '../upload/cloudinary.module';
import { UploadService } from '../upload/upload.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    CloudinaryModule,
    AuthModule,
  ],
  controllers: [AvatarController],
  providers: [AvatarService, PrismaService, UploadService],
  exports: [AvatarService],
})
export class AvatarModule { }