import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { StoryModule } from '../story/story.module';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SpeechToTextService } from './speech-to-text.service';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from './providers/deepgram-tts.provider';
import { ElevenLabsSTTProvider } from './providers/eleven-labs-stt.provider';
import { DeepgramSTTProvider } from './providers/deepgram-stt.provider';
import { SSMLFormatter } from './utils/ssml-formatter';
import { TextChunker } from './utils/text-chunker';
import { StreamConverter } from './utils/stream-converter';
import { VoiceQuotaService } from './voice-quota.service';

@Module({
  imports: [
    AuthModule,
    HttpModule,
    forwardRef(() => StoryModule),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    UploadService,
    PrismaService,
    TextToSpeechService,
    SpeechToTextService,
    ElevenLabsTTSProvider,
    DeepgramTTSProvider,
    ElevenLabsSTTProvider,
    DeepgramSTTProvider,
    SSMLFormatter,
    TextChunker,
    StreamConverter,
    VoiceQuotaService,
  ],
  exports: [
    VoiceService,
    TextToSpeechService,
    SpeechToTextService,
    ElevenLabsTTSProvider,
    DeepgramTTSProvider,
    ElevenLabsSTTProvider,
    DeepgramSTTProvider,
    SSMLFormatter,
    TextChunker,
    StreamConverter,
  ],
})
export class VoiceModule { }
