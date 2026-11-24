// src/upload/upload.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { CloudinaryModule } from './cloudinary.module';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { OrphanedUploadReconciler } from './orphaned-upload-reconciler.service';

@Module({
  imports: [CloudinaryModule, AuthModule],
  controllers: [UploadController],
  providers: [UploadService, OrphanedUploadReconciler],
  exports: [UploadService],
})
export class UploadModule {}
