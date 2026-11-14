// src/upload/upload.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { CloudinaryModule } from './cloudinary.module';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [CloudinaryModule, AuthModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
