// src/upload/upload.module.ts
import { Module } from '@nestjs/common';
import { CloudinaryModule } from './cloudinary.module';
import { UploadService } from './upload.service';

@Module({
  imports: [CloudinaryModule],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
