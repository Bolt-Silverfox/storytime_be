// src/avatar/avatar.module.ts
import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarSeederService } from './avatar.seeder.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryModule } from '../upload/cloudinary.module';
import { UploadService } from '../upload/upload.service';
import { AuthModule } from '../auth/auth.module'; 
import { KidAvatarModule } from '../kid/avatar/kid-avatar.module';

@Module({
  imports: [
    CloudinaryModule,
    AuthModule,
    KidAvatarModule,   
  ],
  controllers: [AvatarController],
  providers: [AvatarService, AvatarSeederService, PrismaService, UploadService],
  exports: [AvatarService, AvatarSeederService],
})
export class AvatarModule {}