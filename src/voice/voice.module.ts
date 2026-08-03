import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@/auth/auth.module';
import { StoryModule } from '../story/story.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { UploadModule } from '../upload/upload.module';
import { NotificationModule } from '../notification/notification.module';
import { GuestModule } from '../guest/guest.module';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SpeechToTextService } from './speech-to-text.service';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from './providers/deepgram-tts.provider';
import { EdgeTTSProvider } from './providers/edge-tts.provider';
import { ElevenLabsSTTProvider } from './providers/eleven-labs-stt.provider';
import { DeepgramSTTProvider } from './providers/deepgram-stt.provider';
import { SSMLFormatter } from './utils/ssml-formatter';
import { TextChunker } from './utils/text-chunker';
import { StreamConverter } from './utils/stream-converter';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceResponseMapper } from './services/voice-response.mapper';
import { VoiceCatalogService } from './services/voice-catalog.service';
import { VoicePreferenceService } from './services/voice-preference.service';
import { VoiceLibraryService } from './services/voice-library.service';
import { VoiceUsageService } from './services/voice-usage.service';
import { VoiceIdResolverService } from './services/voice-id-resolver.service';
import { TTS_BATCH_QUEUE_NAME } from './queue/tts-batch-queue.constants';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { TtsBatchProcessor } from './queue/tts-batch.processor';
import { TtsMetricsService } from './queue/tts-metrics.service';
import { TtsBatchRedisProvider } from './queue/tts-batch-redis.provider';
import {
  VOICE_REPOSITORY,
  PrismaVoiceRepository,
  USER_USAGE_REPOSITORY,
  PrismaUserUsageRepository,
  VOICE_USER_REPOSITORY,
  PrismaVoiceUserRepository,
  ACTIVITY_LOG_REPOSITORY,
  PrismaActivityLogRepository,
  PARAGRAPH_AUDIO_CACHE_REPOSITORY,
  PrismaParagraphAudioCacheRepository,
} from './repositories';

@Module({
  imports: [
    AuthModule,
    HttpModule,
    SubscriptionModule,
    UploadModule,
    NotificationModule,
    forwardRef(() => StoryModule),
    forwardRef(() => GuestModule),
    BullModule.registerQueue({ name: TTS_BATCH_QUEUE_NAME }),
  ],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    VoiceResponseMapper,
    VoiceCatalogService,
    VoicePreferenceService,
    VoiceLibraryService,
    VoiceUsageService,
    VoiceIdResolverService,
    TextToSpeechService,
    SpeechToTextService,
    ElevenLabsTTSProvider,
    DeepgramTTSProvider,
    EdgeTTSProvider,
    ElevenLabsSTTProvider,
    DeepgramSTTProvider,
    SSMLFormatter,
    TextChunker,
    StreamConverter,
    VoiceQuotaService,
    TtsBatchRedisProvider,
    TtsBatchQueueService,
    TtsBatchProcessor,
    TtsMetricsService,
    // Repository Pattern (testability, decoupling)
    {
      provide: VOICE_REPOSITORY,
      useClass: PrismaVoiceRepository,
    },
    {
      provide: USER_USAGE_REPOSITORY,
      useClass: PrismaUserUsageRepository,
    },
    {
      provide: VOICE_USER_REPOSITORY,
      useClass: PrismaVoiceUserRepository,
    },
    {
      provide: ACTIVITY_LOG_REPOSITORY,
      useClass: PrismaActivityLogRepository,
    },
    {
      provide: PARAGRAPH_AUDIO_CACHE_REPOSITORY,
      useClass: PrismaParagraphAudioCacheRepository,
    },
  ],
  exports: [
    VoiceService,
    TextToSpeechService,
    SpeechToTextService,
    ElevenLabsTTSProvider,
    VoiceQuotaService,
  ],
})
export class VoiceModule {}
