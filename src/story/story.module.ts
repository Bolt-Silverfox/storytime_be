import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { ScheduleModule } from '@nestjs/schedule';
import { TextToSpeechService } from './text-to-speech.service';
import { GeminiService } from './gemini.service';
import { AuthModule } from 'src/auth/auth.module';


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
})
export class StoryModule {}
