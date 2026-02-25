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

describe('TextToSpeechService', () => {
  let service: TextToSpeechService;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockDeepgramGenerate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();
  const mockIsPremiumUser = jest.fn();
  const mockIncrementUsage = jest.fn();
  const mockCheckAndReserveUsage = jest.fn();
  const mockReleaseReservedUsage = jest.fn();
  const mockCanUseVoiceForStory = jest.fn();
  const mockCanFreeUserUseElevenLabs = jest.fn();

  const mockPrisma = {
    paragraphAudioCache: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    voice: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset mock implementations (clearAllMocks only resets calls, not implementations)
    mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
    mockPrisma.paragraphAudioCache.upsert.mockResolvedValue({});
    mockPrisma.voice.findUnique.mockResolvedValue(null);
    mockCanUseVoiceForStory.mockResolvedValue(true);
    mockCanFreeUserUseElevenLabs.mockResolvedValue(true);

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
            incrementUsage: mockIncrementUsage,
            checkAndReserveUsage: mockCheckAndReserveUsage,
            releaseReservedUsage: mockReleaseReservedUsage,
            canUseVoiceForStory: mockCanUseVoiceForStory,
            canFreeUserUseElevenLabs: mockCanFreeUserUseElevenLabs,
          },
        },
        {
          provide: SubscriptionService,
          useValue: {
            isPremiumUser: mockIsPremiumUser,
          },
        },
      ],
    }).compile();

    service = module.get<TextToSpeechService>(TextToSpeechService);
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
    const voiceType = VoiceType.CHARLIE;
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
      expect(mockIncrementUsage).toHaveBeenCalledWith(userId);
      expect(mockPrisma.paragraphAudioCache.upsert).toHaveBeenCalled();
    });

    it('should skip ElevenLabs for free users who exhausted their premium voice', async () => {
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
      expect(mockIncrementUsage).not.toHaveBeenCalled();
    });

    it('should return cached URL without calling any provider', async () => {
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue({
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
      expect(mockCanUseVoiceForStory).toHaveBeenCalledWith(storyId, voiceType);
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockDeepgramGenerate).toHaveBeenCalled();
      expect(result).toBe('https://uploaded-audio.com/deepgram.mp3');
    });

    it('should resolve custom UUID voice from database', async () => {
      const customVoiceId = '550e8400-e29b-41d4-a716-446655440000';
      mockPrisma.voice.findUnique.mockResolvedValue({
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

      expect(mockPrisma.voice.findUnique).toHaveBeenCalledWith({
        where: { id: customVoiceId },
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
      mockPrisma.voice.findUnique.mockResolvedValue(null);
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

      expect(mockPrisma.voice.findUnique).toHaveBeenCalledWith({
        where: { id: unknownId },
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
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
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
      mockPrisma.paragraphAudioCache.findUnique.mockResolvedValue(null);
      mockIsPremiumUser.mockResolvedValue(false);
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
        VoiceType.LILY,
        userId,
      );
      expect(result).toEqual({
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
      });
      expect(mockPrisma.paragraphAudioCache.findMany).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace-only text', async () => {
      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        '   \n\t  ',
        VoiceType.LILY,
        userId,
      );
      expect(result).toEqual({
        results: [],
        totalParagraphs: 0,
        wasTruncated: false,
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
              voiceId: 'LILY',
              audioUrl: `https://cached.com/audio-${i}.mp3`,
            })),
          );
        },
      );

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.LILY,
        userId,
      );

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      expect(result.wasTruncated).toBe(false);
      expect(result.totalParagraphs).toBe(result.results.length);
      // No quota should be reserved
      expect(mockCheckAndReserveUsage).not.toHaveBeenCalled();
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
              voiceId: 'LILY',
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
        VoiceType.LILY,
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

    it('should reserve quota for premium users and release unused credits', async () => {
      // No cache hits
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(true);
      // Reserve all requested credits
      mockCheckAndReserveUsage.mockImplementation(
        (_userId: string, credits: number) => Promise.resolve(credits),
      );
      // ElevenLabs fails for all — so all reserved credits should be released
      mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs timeout'));
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('fallback-audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/fallback.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.CHARLIE,
        userId,
      );

      // All paragraphs should have fallback audio
      expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
      // Quota was reserved
      expect(mockCheckAndReserveUsage).toHaveBeenCalledWith(
        userId,
        expect.any(Number),
      );
      // All reserved credits should be released since ElevenLabs failed
      expect(mockReleaseReservedUsage).toHaveBeenCalledWith(
        userId,
        expect.any(Number),
      );
      const releasedCredits = mockReleaseReservedUsage.mock.calls[0][1];
      const reservedCredits = mockCheckAndReserveUsage.mock.calls[0][1];
      expect(releasedCredits).toBe(reservedCredits);
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
        VoiceType.LILY,
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
      let callCount = 0;
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockImplementation(async () => {
        callCount++;
        return Promise.resolve(`https://uploaded.com/audio-${callCount}.wav`);
      });

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        textWithDuplicates,
        VoiceType.LILY,
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
              voiceId: 'LILY',
              audioUrl: 'https://cached.com/refrain.mp3',
            },
          ]);
        },
      );

      mockIsPremiumUser.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/middle.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        textWithDuplicates,
        VoiceType.LILY,
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

    it('should return results sorted by index', async () => {
      mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
      mockIsPremiumUser.mockResolvedValue(false);
      mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
      mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.wav');

      const result = await service.batchTextToSpeechCloudUrls(
        storyId,
        fullText,
        VoiceType.LILY,
        userId,
      );

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i].index).toBeGreaterThan(
          result.results[i - 1].index,
        );
      }
    });
  });
});
