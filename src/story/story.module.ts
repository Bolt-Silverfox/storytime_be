import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { ElevenLabsService } from './elevenlabs.service';
import { GeminiService } from './gemini.service';
import { AuthModule } from 'src/auth/auth.module';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { TextToSpeechService } from './text-to-speech.service';

@Module({
  imports: [HttpModule, ScheduleModule.forRoot(), AuthModule],
  controllers: [StoryController],
  providers: [
    StoryService,
    PrismaService,
    ElevenLabsService,
    UploadService,
    TextToSpeechService,
    GeminiService,
  ],
  exports: [StoryService],
})
export class StoryModule {}
