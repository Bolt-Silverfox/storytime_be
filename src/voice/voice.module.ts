import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '@/auth/auth.module';
import { StoryModule } from '../story/story.module';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '@/prisma/prisma.module';
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
import {
  VOICE_QUOTA_REPOSITORY,
  PrismaVoiceQuotaRepository,
} from './repositories';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HttpModule,
    UploadModule,
    forwardRef(() => StoryModule),
  ],
  controllers: [VoiceController],
  providers: [
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
    VoiceQuotaService,
    {
      provide: VOICE_QUOTA_REPOSITORY,
      useClass: PrismaVoiceQuotaRepository,
    },
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
    VoiceQuotaService,
  ],
})
export class VoiceModule {}
