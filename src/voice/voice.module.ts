import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@/auth/auth.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { StoryModule } from '../story/story.module';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SpeechToTextService } from './speech-to-text.service';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import { StyleTTS2TTSProvider } from './providers/styletts2-tts.provider';
import { EdgeTTSProvider } from './providers/edge-tts.provider';
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
import { VOICE_QUEUE_NAME, VoiceQueueService, VoiceProcessor } from './queue';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HttpModule,
    UploadModule,
    NotificationModule,
    SubscriptionModule,
    forwardRef(() => StoryModule),
    // Register voice synthesis queue
    BullModule.registerQueue({
      name: VOICE_QUEUE_NAME,
    }),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    TextToSpeechService,
    SpeechToTextService,
    ElevenLabsTTSProvider,
    StyleTTS2TTSProvider,
    EdgeTTSProvider,
    ElevenLabsSTTProvider,
    DeepgramSTTProvider,
    SSMLFormatter,
    TextChunker,
    StreamConverter,
    VoiceQuotaService,
    VoiceQueueService,
    VoiceProcessor,
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
    StyleTTS2TTSProvider,
    EdgeTTSProvider,
    ElevenLabsSTTProvider,
    DeepgramSTTProvider,
    SSMLFormatter,
    TextChunker,
    StreamConverter,
    VoiceQuotaService,
    VoiceQueueService,
  ],
})
export class VoiceModule {}
