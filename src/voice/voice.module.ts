import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { StoryModule } from '../story/story.module';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [
    AuthModule,
    StoryModule, // <-- IMPORT instead of re-providing StoryService
  ],
  controllers: [VoiceController],
  providers: [VoiceService, UploadService, PrismaService, TextToSpeechService],
  exports: [VoiceService, TextToSpeechService],
})
export class VoiceModule {}
