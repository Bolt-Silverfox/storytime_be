import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { AvatarSeederService } from './avatar.seeder.service';
import { CloudinaryModule } from '../upload/cloudinary.module';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CloudinaryModule, AuthModule, UploadModule],
  controllers: [AvatarController],
  providers: [AvatarService, AvatarSeederService],
  exports: [AvatarService, AvatarSeederService],
})
export class AvatarModule {}