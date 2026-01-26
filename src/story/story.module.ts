import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@/auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { GeminiService } from './gemini.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UploadModule,
    forwardRef(() => VoiceModule),
  ],
  controllers: [StoryController],
  providers: [
    StoryService,
    GeminiService,
  ],
  exports: [StoryService],
})
export class StoryModule { }
