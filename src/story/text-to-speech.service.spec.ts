import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  TextToSpeechService,
  preprocessTextForTTS,
} from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { VoiceType } from '../voice/dto/voice.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { MAX_TTS_TEXT_LENGTH } from '../voice/voice.config';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { TTS_CIRCUIT_BREAKER_CONFIG } from '@/shared/constants/circuit-breaker.constants';
import { VOICE_CONFIG } from '../voice/voice.constants';

describe('TextToSpeechService', () => {
  let service: TextToSpeechService;
  let cbService: CircuitBreakerService;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockDeepgramGenerate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();
  const mockIsPremiumUser = jest.fn();
  const mockCanUseVoiceForStory = jest.fn();
  const mockCanFreeUserUseElevenLabs = jest.fn();
  const mockResolveCanonicalVoiceId = jest.fn();

  const mockPrisma = {
    paragraphAudioCache: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    voice: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset mock implementations (clearAllMocks only resets calls, not implementations)
    mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue(null);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
    mockPrisma.paragraphAudioCache.upsert.mockResolvedValue({});
    mockPrisma.voice.findFirst.mockResolvedValue(null);
    mockCanUseVoiceForStory.mockResolvedValue(true);
    mockCanFreeUserUseElevenLabs.mockResolvedValue(true);
    // Resolve known VoiceType enum keys to their ElevenLabs IDs,
    // mirroring the real VoiceQuotaService.resolveCanonicalVoiceId behaviour.
    mockResolveCanonicalVoiceId.mockImplementation((id: string) => {
      const config = VOICE_CONFIG[id as VoiceType];
      return Promise.resolve(config ? config.elevenLabsId : id);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TextToSpeechService,
        {
          provide: UploadService,
          useValue: {
            uploadAudioBuffer: mockUploadAudio,
          },
        },
        {
          provide: ElevenLabsTTSProvider,
          useValue: {
            generateAudio: mockElevenLabsGenerate,
          },
        },
        {
          provide: DeepgramTTSProvider,
          useValue: {
            generateAudio: mockDeepgramGenerate,
          },
        },
        {
          provide: EdgeTTSProvider,
          useValue: {
            generateAudio: mockEdgeTtsGenerate,
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: VoiceQuotaService,
          useValue: {
            canUseVoiceForStory: mockCanUseVoiceForStory,
            canFreeUserUseElevenLabs: mockCanFreeUserUseElevenLabs,
            resolveCanonicalVoiceId: mockResolveCanonicalVoiceId,
          },
        },
        {
          provide: SubscriptionService,
          useValue: {
            isPremiumUser: mockIsPremiumUser,
          },
        },
        CircuitBreakerService,
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
    cbService = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('preprocessTextForTTS', () => {
    it('should strip double quotes', () => {
      expect(preprocessTextForTTS('"Hello" world')).toBe('Hello world');
    });

    it('should strip curly double quotes', () => {
      expect(preprocessTextForTTS('\u201CHello\u201D')).toBe('Hello');
    });

    it('should preserve contractions', () => {
      expect(preprocessTextForTTS("don't it's I'm")).toBe("don't it's I'm");
    });

    it('should strip standalone single quotes', () => {
      expect(preprocessTextForTTS("'Hello' world")).toBe('Hello world');
    });

    it('should collapse whitespace and trim', () => {
      expect(preprocessTextForTTS('  hello   world  ')).toBe('hello world');
    });
  });

  describe('textToSpeechCloudUrl', () => {
    const storyId = 'story-123';
    const text = 'Once upon a time';
    const voiceType = VoiceType.MILO;
    const userId = 'user-123';

    it('should use ElevenLabs for premium users', async () => {
      mockIsPremiumUser.mockResolvedValue(true);

      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('eleven-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/eleven.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockUploadAudio).toHaveBeenCalledWith(
        Buffer.from('eleven-audio'),
        expect.stringContaining('elevenlabs'),
      );
      expect(result).toBe('https://uploaded-audio.com/eleven.mp3');
      expect(mockDeepgramGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
      expect(mockPrisma.paragraphAudioCache.upsert).toHaveBeenCalled();
    });

    it('should allow ElevenLabs for free user trial story', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(true);
      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('eleven-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/eleven.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockCanFreeUserUseElevenLabs).toHaveBeenCalledWith(
        userId,
        expect.any(String),
        storyId,
      );
      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/eleven.mp3');
    });

    it('should skip ElevenLabs for free user after trial is used (Deepgram → Edge TTS chain)', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/deepgram.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockCanFreeUserUseElevenLabs).toHaveBeenCalledWith(
        userId,
        expect.any(String),
        storyId,
      );
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/deepgram.mp3');
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    });

    it('should fallback to Edge TTS if Deepgram fails', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram timeout'));
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
    });

    it('should fallback through all 3 tiers for premium users', async () => {
      mockIsPremiumUser.mockResolvedValue(true);

      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram Error'));
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
    });

    it('should return cached URL without calling any provider', async () => {
      mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue({
        audioUrl: 'https://cached.com/audio.mp3',
      });

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(result).toBe('https://cached.com/audio.mp3');
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    });

    it('should not return cross-provider cached URL when providerOverride is set', async () => {
      // Simulate batch mode: Deepgram is the override provider.
      // An ElevenLabs cache entry exists but should NOT be returned.
      mockPrisma.paragraphAudioCache.findFirst.mockImplementation(
        (args: { where: { provider?: string } }) => {
          // Only return cache when no provider filter (or provider is 'elevenlabs')
          if (!args.where.provider || args.where.provider === 'elevenlabs') {
            return Promise.resolve({
              audioUrl: 'https://cached.com/elevenlabs-audio.mp3',
              provider: 'elevenlabs',
            });
          }
          // No cache for deepgram
          return Promise.resolve(null);
        },
      );

      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/deepgram.mp3',
      );

      // Call generateTTS indirectly via textToSpeechCloudUrl won't use providerOverride,
      // so we use the batch path to trigger it. But for a simpler test, we can
      // call the service method that sets providerOverride internally.
      // Use batch with a single short paragraph:
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        text,
        voiceType,
        userId,
      );

      // Deepgram should have been called (not served from ElevenLabs cache)
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
    });

    it('should throw error if all providers fail for premium user', async () => {
      mockIsPremiumUser.mockResolvedValue(true);

      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs Error'));
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on all providers');
    });

    it('should throw error if all providers fail for free user', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram Error'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS Error'));

      await expect(
        service.textToSpeechCloudUrl(storyId, text, voiceType, userId),
      ).rejects.toThrow('Voice generation failed on all providers');
    });

    it('should deny anonymous requests for ElevenLabs voices', async () => {
      // No userId provided — should skip ElevenLabs, use Deepgram
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/deepgram.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        // no userId
      );

      expect(mockIsPremiumUser).not.toHaveBeenCalled();
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/deepgram.mp3');
    });

    it('should skip ElevenLabs when per-story voice limit reached', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockCanUseVoiceForStory.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/deepgram.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockIsPremiumUser).toHaveBeenCalledWith(userId);
      expect(mockCanUseVoiceForStory).toHaveBeenCalledWith(
        storyId,
        'NFG5qt843uXKj4pFvR7C',
      );
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/deepgram.mp3');
    });

    it('should resolve custom UUID voice from database', async () => {
      const customVoiceId = '550e8400-e29b-41d4-a716-446655440000';
      mockPrisma.voice.findFirst.mockResolvedValue({
        id: customVoiceId,
        elevenLabsVoiceId: 'custom-eleven-id',
      });
      mockIsPremiumUser.mockResolvedValue(true);

      mockElevenLabsGenerate.mockResolvedValue(Buffer.from('custom-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/custom.mp3',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        customVoiceId,
        userId,
      );

      expect(mockPrisma.voice.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: customVoiceId }, { name: customVoiceId }],
          isDeleted: false,
        },
      });
      expect(mockElevenLabsGenerate).toHaveBeenCalledWith(
        expect.any(String),
        'custom-eleven-id',
        expect.any(String),
        expect.any(Object),
      );
      expect(result).toBe('https://uploaded-audio.com/custom.mp3');
    });

    it('should fallback to default for unrecognized voice ID', async () => {
      const unknownId = 'unknown-voice-id';
      mockPrisma.voice.findFirst.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('default-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/default.wav',
      );

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        unknownId,
        userId,
      );

      expect(mockPrisma.voice.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: unknownId }, { name: unknownId }],
          isDeleted: false,
        },
      });
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/default.wav');
    });

    it('should throw when text exceeds max length', async () => {
      const longText = 'x'.repeat(MAX_TTS_TEXT_LENGTH + 1);

      await expect(
        service.textToSpeechCloudUrl(storyId, longText, voiceType, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use default voice when voicetype is not provided', async () => {
      mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.wav');

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        undefined,
        userId,
      );

      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/audio.wav');
    });

    it('should still return audio when cache write fails', async () => {
      mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.wav');
      mockPrisma.paragraphAudioCache.upsert.mockRejectedValue(
        new Error('DB write failed'),
      );

      // Should not throw — cache failure is non-fatal
      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(result).toBe('https://uploaded-audio.com/audio.wav');
    });
  });

  describe('batchTextToSpeechCloudUrls', () => {
    const storyId = 'story-batch-123';
    const userId = 'user-batch-123';
    // Each "paragraph" needs enough words to form separate chunks (splitter uses ~30 words/chunk)
    const makeText = (paragraphs: string[]) => paragraphs.join(' ');

    // Short texts that each fit in one chunk
    const shortParagraph1 = 'The cat sat on the mat and looked at the stars.';
    const shortParagraph2 =
      'The dog ran through the field chasing butterflies in the sun.';
    const shortParagraph3 =
      'A small bird sang a sweet melody from the old oak tree.';

    // Full text with 3 short paragraphs (each under 30 words, will be separate chunks)
    const fullText = makeText([
      shortParagraph1,
      shortParagraph2,
      shortParagraph3,
    ]);

    it('should return empty results for empty text', async () => {
      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        '',
        VoiceType.NIMBUS,
        userId,
      );
      expect(result).toEqual({
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
        usedProvider: 'none',
      });
      expect(mockPrisma.paragraphAudioCache.findMany).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace-only text', async () => {
      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        '   \n\t  ',
        VoiceType.NIMBUS,
        userId,
      );
      expect(result).toEqual({
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
        usedProvider: 'none',
      });
    });

    it('should return cached results without reserving quota when all cached', async () => {
      // The splitter will split fullText into chunks — we mock findMany to return
      // cached entries for all of them. We use a spy on hashText to capture hashes.
      mockPrisma.paragraphAudioCache.findMany.mockImplementation(
        (args: { where: { textHash: { in: string[] } } }) => {
          const hashes = args.where.textHash.in;
          return Promise.resolve(
            hashes.map((hash: string, i: number) => ({
              storyId,
              textHash: hash,
              voiceId: 'NIMBUS',
              audioUrl: `https://cached.com/audio-${i}.mp3`,
            })),
          );
        },
      );

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.NIMBUS,
        userId,
      );

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      expect(result.wasTruncated).toBe(false);
      expect(result.totalParagraphs).toBe(result.results.length);
      // No providers should be called
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    });

    it('should call providers only for uncached paragraphs', async () => {
      // Cache the first paragraph hash only
      mockPrisma.paragraphAudioCache.findMany.mockImplementation(
        (args: { where: { textHash: { in: string[] } } }) => {
          const hashes = args.where.textHash.in;
          // Only return cache entry for the first hash
          return Promise.resolve([
            {
              storyId,
              textHash: hashes[0],
              voiceId: 'NIMBUS',
              audioUrl: 'https://cached.com/first.mp3',
            },
          ]);
        },
      );

      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('generated-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/new.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.NIMBUS,
        userId,
      );

      // Should have results for all paragraphs
      expect(result.results.length).toBeGreaterThan(1);
      expect(result.wasTruncated).toBe(false);
      expect(result.totalParagraphs).toBe(result.results.length);
      // First paragraph should be cached
      const sorted = [...result.results].sort((a, b) => a.index - b.index);
      expect(sorted[0].audioUrl).toBe('https://cached.com/first.mp3');
      // Other paragraphs should have been generated
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].audioUrl).toBe('https://uploaded.com/new.wav');
      }
      // No ElevenLabs for free user
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      // Deepgram should be called for uncached paragraphs only
      expect(mockDeepgramGenerate).toHaveBeenCalledTimes(
        result.results.length - 1, // minus 1 cached
      );
    });

    it('should failover through all providers when each fails', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(true);
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs timeout'));
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram timeout'));
      mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS timeout'));

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.MILO,
        userId,
      );

      expect(result.results.every((r) => r.audioUrl === null)).toBe(true);
      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
    });

    it('should failover to Edge TTS when free-user Deepgram fails', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      // Deepgram fails
      mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram outage'));
      // Edge TTS succeeds
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/edge.mp3');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.NIMBUS,
        userId,
      );

      // All paragraphs should have audio (failover to Edge TTS)
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      // ElevenLabs should not be called for free users
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      // Deepgram was attempted
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      // Edge TTS was used as fallback
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result.usedProvider).toBe('edgetts');
      expect(result.preferredProvider).toBe('deepgram');
    });

    it('should deny ElevenLabs override when quota is exhausted for free users', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      // Batch-level check allows ElevenLabs
      mockCanFreeUserUseElevenLabs.mockResolvedValueOnce(true);
      // Per-paragraph check denies (quota exhausted after batch decision)
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      // Deepgram succeeds as failover after ElevenLabs quota denial
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/deepgram.mp3');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.MILO,
        userId,
      );

      // ElevenLabs should never be invoked — quota guard prevents dispatch
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      // Failover to Deepgram should succeed
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      expect(result.usedProvider).toBe('deepgram');
      expect(result.preferredProvider).toBe('elevenlabs');
    });

    it('should cap paragraphs at MAX_BATCH_PARAGRAPHS (50)', async () => {
      // Generate text with way more than 50 words to produce many paragraphs
      // Each word-count chunk is ~30 words, so 60 chunks = ~1800 words
      const words = Array.from({ length: 1800 }, (_, i) => `word${i}`).join(
        ' ',
      );

      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        words,
        VoiceType.NIMBUS,
        userId,
      );

      expect(result.results.length).toBeLessThanOrEqual(50);
      expect(result.wasTruncated).toBe(true);
      expect(result.totalParagraphs).toBeGreaterThan(50);
    });

    it('should return all indices when paragraphs have duplicate text', async () => {
      // Construct text where a refrain repeats, creating duplicate chunks.
      // The refrain is exactly one chunk (~30 words); a middle section separates them.
      // We join with ' ' so the splitter sees: [refrain chunk] [middle chunk] [refrain chunk].
      const refrain = Array.from({ length: 30 }, (_, i) => `refrain${i}`).join(
        ' ',
      );
      const middle = Array.from({ length: 30 }, (_, i) => `middle${i}`).join(
        ' ',
      );
      const textWithDuplicates = `${refrain} ${middle} ${refrain}`;

      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      let callCount = 0;
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockImplementation(async () => {
        callCount++;
        return Promise.resolve(`https://uploaded.com/audio-${callCount}.wav`);
      });

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        textWithDuplicates,
        VoiceType.NIMBUS,
        userId,
      );

      // Group results by text to find duplicates
      const { results } = result;
      const textToResults = new Map<string, typeof results>();
      for (const r of results) {
        const existing = textToResults.get(r.text) ?? [];
        existing.push(r);
        textToResults.set(r.text, existing);
      }

      // Find groups with duplicate text
      const duplicateGroups = [...textToResults.values()].filter(
        (g) => g.length > 1,
      );
      // There should be at least one group of duplicates (the refrain)
      expect(duplicateGroups.length).toBeGreaterThan(0);

      // All entries in each duplicate group should share the same audioUrl
      for (const group of duplicateGroups) {
        const urls = group.map((r) => r.audioUrl);
        expect(new Set(urls).size).toBe(1);
      }

      // All results should have audio
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);

      // Provider should be called once per unique text, not once per chunk
      const uniqueTexts = new Set(result.results.map((r) => r.text)).size;
      expect(mockDeepgramGenerate).toHaveBeenCalledTimes(uniqueTexts);
      expect(mockDeepgramGenerate.mock.calls.length).toBeLessThan(
        result.results.length,
      );
    });

    it('should reuse cached URL for all duplicate paragraphs', async () => {
      const refrain =
        'Twinkle twinkle little star how I wonder what you are up above the world so high like a diamond in the sky shining bright throughout the night.';
      const middle =
        'When the blazing sun is gone when he nothing shines upon then you show your little light twinkle twinkle all the night in the dark blue sky you keep.';
      const textWithDuplicates = [refrain, middle, refrain].join(' ');

      // Cache hit for the refrain hash
      mockPrisma.paragraphAudioCache.findMany.mockImplementation(
        (args: { where: { textHash: { in: string[] } } }) => {
          const hashes = args.where.textHash.in;
          // Return cache for first hash only (which is the refrain)
          return Promise.resolve([
            {
              storyId,
              textHash: hashes[0],
              voiceId: 'NIMBUS',
              audioUrl: 'https://cached.com/refrain.mp3',
            },
          ]);
        },
      );

      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/middle.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        textWithDuplicates,
        VoiceType.NIMBUS,
        userId,
      );

      expect(result.results.length).toBe(3);
      const sorted = [...result.results].sort((a, b) => a.index - b.index);
      // First and third (refrain) should both have the cached URL
      expect(sorted[0].audioUrl).toBe('https://cached.com/refrain.mp3');
      expect(sorted[2].audioUrl).toBe('https://cached.com/refrain.mp3');
      // Middle should be generated
      expect(sorted[1].audioUrl).toBe('https://uploaded.com/middle.wav');
      // Only 1 paragraph should be generated (the middle one)
      expect(mockDeepgramGenerate).toHaveBeenCalledTimes(1);
    });

    it('should failover to Deepgram when ElevenLabs fails mid-batch', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(true);

      // ElevenLabs fails for all paragraphs
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs 500'));
      // Deepgram succeeds
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.MILO,
        userId,
      );

      // All paragraphs should have audio (failover to Deepgram)
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      // ElevenLabs was attempted
      expect(mockElevenLabsGenerate).toHaveBeenCalled();
      // Deepgram was used as fallback
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      // Response indicates fallback happened
      expect(result.usedProvider).toBe('deepgram');
      expect(result.preferredProvider).toBe('elevenlabs');
    });

    it('should return results sorted by index', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.NIMBUS,
        userId,
      );

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i].index).toBeGreaterThan(
          result.results[i - 1].index,
        );
      }
    });
  });

  describe('circuit breaker integration', () => {
    const storyId = 'story-cb-123';
    const text = 'Once upon a time in a land far away';
    const voiceType = VoiceType.MILO;
    const userId = 'user-cb-123';

    it('should skip ElevenLabs when its breaker is OPEN and fall through to Deepgram', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
      mockUploadAudio.mockResolvedValue(
        'https://uploaded-audio.com/deepgram.mp3',
      );

      // Trip the ElevenLabs breaker
      const elBreaker = cbService.getBreaker('elevenlabs');
      for (
        let i = 0;
        i < TTS_CIRCUIT_BREAKER_CONFIG.elevenlabs.failureThreshold;
        i++
      ) {
        elBreaker.recordFailure({ status: 500 });
      }

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/deepgram.mp3');
    });

    it('should skip Deepgram when its breaker is OPEN and fall through to Edge TTS', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/edge.mp3');

      // Trip the Deepgram breaker
      const dgBreaker = cbService.getBreaker('deepgram');
      for (
        let i = 0;
        i < TTS_CIRCUIT_BREAKER_CONFIG.deepgram.failureThreshold;
        i++
      ) {
        dgBreaker.recordFailure({ status: 503 });
      }

      const result = await service.textToSpeechCloudUrl(
        storyId,
        text,
        voiceType,
        userId,
      );

      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/edge.mp3');
    });

    it('should record success on the breaker after successful provider call', async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.mp3');

      const dgBreaker = cbService.getBreaker('deepgram');
      const successSpy = jest.spyOn(dgBreaker, 'recordSuccess');

      await service.textToSpeechCloudUrl(storyId, text, voiceType, userId);

      expect(successSpy).toHaveBeenCalled();
    });

    it('should record failure on the breaker after provider error', async () => {
      mockIsPremiumUser.mockResolvedValue(true);
      mockElevenLabsGenerate.mockRejectedValue(
        Object.assign(new Error('Server Error'), { status: 500 }),
      );
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded-audio.com/audio.mp3');

      const elBreaker = cbService.getBreaker('elevenlabs');
      const failureSpy = jest.spyOn(elBreaker, 'recordFailure');

      await service.textToSpeechCloudUrl(storyId, text, voiceType, userId);

      expect(failureSpy).toHaveBeenCalled();
    });

    describe('batch mode', () => {
      const shortParagraph1 = 'The cat sat on the mat and looked at the stars.';
      const shortParagraph2 =
        'The dog ran through the field chasing butterflies in the sun.';
      const fullText = `${shortParagraph1} ${shortParagraph2}`;

      it('should downgrade from ElevenLabs to Deepgram when ElevenLabs breaker is OPEN', async () => {
        mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
        mockIsPremiumUser.mockResolvedValue(true);
        mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
        mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

        // Trip the ElevenLabs breaker
        const elBreaker = cbService.getBreaker('elevenlabs');
        for (
          let i = 0;
          i < TTS_CIRCUIT_BREAKER_CONFIG.elevenlabs.failureThreshold;
          i++
        ) {
          elBreaker.recordFailure({ status: 500 });
        }

        const result = await service.batchTextToSpeechCloudUrls(
          storyId,
          fullText,
          VoiceType.MILO,
          userId,
        );

        // Should have used Deepgram, not ElevenLabs
        expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
        expect(mockDeepgramGenerate).toHaveBeenCalled();
        expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      });

      it('should return providerStatus: degraded when a breaker is OPEN', async () => {
        mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
        mockIsPremiumUser.mockResolvedValue(false);
        mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
        mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
        mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

        // Trip the ElevenLabs breaker (even though free user won't use it,
        // the degraded status should still be reported)
        const elBreaker = cbService.getBreaker('elevenlabs');
        for (
          let i = 0;
          i < TTS_CIRCUIT_BREAKER_CONFIG.elevenlabs.failureThreshold;
          i++
        ) {
          elBreaker.recordFailure({ status: 500 });
        }

        const result = await service.batchTextToSpeechCloudUrls(
          storyId,
          fullText,
          VoiceType.NIMBUS,
          userId,
        );

        expect(result.providerStatus).toBe('degraded');
      });

      it('should NOT return providerStatus when all breakers are healthy', async () => {
        mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
        mockIsPremiumUser.mockResolvedValue(false);
        mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
        mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
        mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

        const result = await service.batchTextToSpeechCloudUrls(
          storyId,
          fullText,
          VoiceType.NIMBUS,
          userId,
        );

        expect(result.providerStatus).toBeUndefined();
      });
    });
  });
});
