import { Module } from '@nestjs/common';
import { StoryBuddyController } from './story-buddy.controller';
import { StoryBuddyService } from './story-buddy.service';
import { BuddySelectionService } from './buddy-selection.service';
import { BuddyMessagingService } from './buddy-messaging.service';
import { StoryBuddySeederService } from './story-buddy.seeder';
import { STORY_BUDDY_REPOSITORY } from './repositories/story-buddy.repository.interface';
import { PrismaStoryBuddyRepository } from './repositories/prisma-story-buddy.repository';
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
  providers: [
    StoryBuddyService,
    BuddySelectionService,
    BuddyMessagingService,
    StoryBuddySeederService,
    {
      provide: STORY_BUDDY_REPOSITORY,
      useClass: PrismaStoryBuddyRepository,
    }
  ],
  exports: [StoryBuddyService, BuddySelectionService, BuddyMessagingService],
})
export class StoryBuddyModule { }
