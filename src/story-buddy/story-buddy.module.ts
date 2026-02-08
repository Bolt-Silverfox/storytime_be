import { Module } from '@nestjs/common';
import { StoryBuddyController } from './story-buddy.controller';
import { StoryBuddyService } from './story-buddy.service';
import { StoryBuddySeederService } from './story-buddy.seeder';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    UploadModule, // Make sure this is properly imported
    AuthModule,
  ],
  controllers: [StoryBuddyController],
  providers: [StoryBuddyService, StoryBuddySeederService],
  exports: [StoryBuddyService],
})
export class StoryBuddyModule {}
