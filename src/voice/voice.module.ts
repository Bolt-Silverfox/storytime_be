import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { StoryModule } from '../story/story.module';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SpeechToTextService } from './speech-to-text.service';

@Module({
  imports: [
    AuthModule,
    StoryModule,
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    UploadService,
    PrismaService,
    TextToSpeechService,
    SpeechToTextService,
  ],
  exports: [VoiceService, TextToSpeechService, SpeechToTextService],
})
export class VoiceModule { }
