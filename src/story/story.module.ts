import { HttpModule } from '@nestjs/axios';
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { GeminiService } from './gemini.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [HttpModule, ScheduleModule.forRoot(), AuthModule, forwardRef(() => VoiceModule)],
  controllers: [StoryController],
  providers: [
    StoryService,
    PrismaService,
    UploadService,
    GeminiService,
  ],
  exports: [StoryService],
})
export class StoryModule { }
