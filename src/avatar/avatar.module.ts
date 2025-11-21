import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarSeederService } from './avatar.seeder.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryModule } from '../upload/cloudinary.module';
import { UploadService } from '../upload/upload.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [AvatarController],
  providers: [AvatarService, AvatarSeederService, PrismaService, UploadService],
  exports: [AvatarService, AvatarSeederService],
})
export class AvatarModule {}
