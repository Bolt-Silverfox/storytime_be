import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@/auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { GeminiService } from './gemini.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { StoryQuotaService } from './story-quota.service';
import { VoiceModule } from '../voice/voice.module';
import { StoryAccessGuard } from '@/shared/guards/story-access.guard';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UploadModule,
    forwardRef(() => VoiceModule),
  ],
  controllers: [StoryController],
  providers: [StoryService, GeminiService, StoryQuotaService, StoryAccessGuard],
  exports: [StoryService, StoryQuotaService],
})
export class StoryModule {}
