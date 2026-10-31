import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { TextToSpeechService } from './text-to-speech.service';
import { UploadService } from '../upload/upload.service';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { DeepgramTTSProvider } from '../voice/providers/deepgram-tts.provider';
import { EdgeTTSProvider } from '../voice/providers/edge-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';
import { VOICE_CONFIG, DEFAULT_VOICE } from '../voice/voice.constants';
import { splitByWordCountPreservingSentences } from '../voice/utils/paragraph-splitter';
import { preprocessTextForTTS } from './tts/tts-text.util';

const STORY_ID = '24fe8886-f166-4073-a173-636873caac31';
const DEFAULT_EL_ID = VOICE_CONFIG[DEFAULT_VOICE].elevenLabsId;

/** One 30-word sentence per paragraph so the 30-word splitter yields n chunks. */
const buildStory = (n: number, wordsPerParagraph = 30): string =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: wordsPerParagraph - 1 }, (_w, w) => `w${i}x${w}`)
      .concat([`end${i}.`])
      .join(' '),
  ).join(' ');

const paragraphsOf = (text: string): string[] =>
  splitByWordCountPreservingSentences(text, 30);

const hashOf = (text: string): string =>
  createHash('sha256').update(preprocessTextForTTS(text)).digest('hex');

const cacheRow = (
  text: string,
  voiceId: string,
  provider: string,
  audioUrl: string,
) => ({
  id: `${voiceId}-${provider}-${hashOf(text).slice(0, 6)}`,
  storyId: STORY_ID,
  textHash: hashOf(text),
  voiceId,
  provider,
  audioUrl,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('TextToSpeechService.batchTextToSpeechForGuest', () => {
  let service: TextToSpeechService;

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockDeepgramGenerate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();
  const mockIsPremiumUser = jest.fn();
  const mockCanFreeUserUseElevenLabs = jest.fn();
  const mockCanUseVoiceForStory = jest.fn();

  const mockPrisma = {
    paragraphAudioCache: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    voice: { findFirst: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue(null);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
    mockPrisma.paragraphAudioCache.upsert.mockResolvedValue({});
    mockPrisma.voice.findFirst.mockResolvedValue(null);
    mockPrisma.voice.findMany.mockResolvedValue([]);
    mockDeepgramGenerate.mockResolvedValue(Buffer.from('dg'));
    mockEdgeTtsGenerate.mockResolvedValue(Buffer.from('edge'));
    mockElevenLabsGenerate.mockResolvedValue(Buffer.from('el'));
    mockUploadAudio.mockImplementation((_b: Buffer, name: string) =>
      Promise.resolve(`https://cdn.test/${name}`),
    );
    mockCanFreeUserUseElevenLabs.mockResolvedValue(true);
    mockCanUseVoiceForStory.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TextToSpeechService,
        {
          provide: UploadService,
          useValue: { uploadAudioBuffer: mockUploadAudio },
        },
        {
          provide: ElevenLabsTTSProvider,
          useValue: { generateAudio: mockElevenLabsGenerate },
        },
        {
          provide: DeepgramTTSProvider,
          useValue: { generateAudio: mockDeepgramGenerate },
        },
        {
          provide: EdgeTTSProvider,
          useValue: { generateAudio: mockEdgeTtsGenerate },
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: VoiceQuotaService,
          useValue: {
            canUseVoiceForStory: mockCanUseVoiceForStory,
            canFreeUserUseElevenLabs: mockCanFreeUserUseElevenLabs,
            resolveCanonicalVoiceId: jest.fn((id: string) =>
              Promise.resolve(
                VOICE_CONFIG[id as keyof typeof VOICE_CONFIG]?.elevenLabsId ??
                  id,
              ),
            ),
          },
        },
        {
          provide: SubscriptionService,
          useValue: { isPremiumUser: mockIsPremiumUser },
        },
        CircuitBreakerService,
      ],
    }).compile();

    service = module.get(TextToSpeechService);
  });

  it('serves a FULL cache hit with zero provider/upload calls (rows under mixed voice-id aliases and providers)', async () => {
    const text = buildStory(4);
    const paras = paragraphsOf(text);
    expect(paras).toHaveLength(4);
    mockPrisma.voice.findMany.mockResolvedValue([{ id: 'voice-row-uuid' }]);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([
      cacheRow(paras[0], 'default', 'edgetts', 'https://a/0.mp3'),
      cacheRow(paras[1], DEFAULT_VOICE, 'deepgram', 'https://a/1.mp3'),
      cacheRow(paras[2], DEFAULT_EL_ID, 'elevenlabs', 'https://a/2.mp3'),
      cacheRow(paras[3], 'voice-row-uuid', 'unknown', 'https://a/3.mp3'),
    ]);

    const res = await service.batchTextToSpeechForGuest(STORY_ID, text);

    expect(res.results.map((r) => r.audioUrl)).toEqual([
      'https://a/0.mp3',
      'https://a/1.mp3',
      'https://a/2.mp3',
      'https://a/3.mp3',
    ]);
    expect(res.remainingUncached).toEqual([]);
    expect(res.totalParagraphs).toBe(4);
    expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
    expect(mockDeepgramGenerate).not.toHaveBeenCalled();
    expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
    expect(mockUploadAudio).not.toHaveBeenCalled();
    expect(mockPrisma.paragraphAudioCache.upsert).not.toHaveBeenCalled();
    // The lookup is not scoped to one provider and covers every alias.
    const where =
      mockPrisma.paragraphAudioCache.findMany.mock.calls[0][0].where;
    expect(where.provider).toBeUndefined();
    expect(where.voiceId.in).toEqual(
      expect.arrayContaining([
        'default',
        DEFAULT_VOICE,
        DEFAULT_EL_ID,
        'voice-row-uuid',
        'LILY',
      ]),
    );
  });

  it('prefers the provider covering most paragraphs, then fills gaps from others', async () => {
    const text = buildStory(3);
    const paras = paragraphsOf(text);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([
      cacheRow(paras[0], DEFAULT_EL_ID, 'elevenlabs', 'https://el/0.mp3'),
      cacheRow(paras[0], 'default', 'edgetts', 'https://edge/0.mp3'),
      cacheRow(paras[1], 'default', 'edgetts', 'https://edge/1.mp3'),
      cacheRow(paras[2], 'default', 'edgetts', 'https://edge/2.mp3'),
    ]);
    const res = await service.batchTextToSpeechForGuest(STORY_ID, text);
    expect(res.results.map((r) => r.audioUrl)).toEqual([
      'https://edge/0.mp3',
      'https://edge/1.mp3',
      'https://edge/2.mp3',
    ]);
    expect(mockDeepgramGenerate).not.toHaveBeenCalled();
  });

  it('on a partial hit generates ONLY the missing paragraphs, never with ElevenLabs, and caches them under the default voice', async () => {
    const text = buildStory(5);
    const paras = paragraphsOf(text);
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([
      cacheRow(paras[0], 'default', 'edgetts', 'https://a/0.mp3'),
      cacheRow(paras[3], 'default', 'edgetts', 'https://a/3.mp3'),
    ]);

    const res = await service.batchTextToSpeechForGuest(STORY_ID, text, {
      eagerCount: 1,
    });

    // 3 missing (1,2,4): 1 eager now, 2 handed back for the queue.
    expect(mockDeepgramGenerate).toHaveBeenCalledTimes(1);
    expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
    expect(res.remainingUncached.map((p) => p.index)).toEqual([2, 4]);
    expect(res.batchProvider).toBe('deepgram');
    expect(res.results.map((r) => r.index)).toEqual([0, 1, 3]);
    const upsert = mockPrisma.paragraphAudioCache.upsert.mock.calls[0][0];
    expect(upsert.create.voiceId).toBe(DEFAULT_VOICE);
    expect(upsert.create.provider).toBe('deepgram');
    expect(upsert.create.storyId).toBe(STORY_ID);
  });

  it('never calls ElevenLabs for guests even when the whole story is a miss', async () => {
    const text = buildStory(2);
    await service.batchTextToSpeechForGuest(STORY_ID, text, { eagerCount: 2 });
    expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
    expect(mockCanFreeUserUseElevenLabs).not.toHaveBeenCalled();
    expect(mockDeepgramGenerate).toHaveBeenCalledTimes(2);
  });

  it('caps the paragraphs considered per request', async () => {
    const text = buildStory(10);
    const res = await service.batchTextToSpeechForGuest(STORY_ID, text, {
      eagerCount: 0,
      maxParagraphs: 4,
    });
    expect(res.wasTruncated).toBe(true);
    // totalParagraphs reflects what can actually be served, so a client
    // progress indicator can finish (it used to say 10 for 4 served).
    expect(res.totalParagraphs).toBe(4);
    expect(res.remainingUncached.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(mockDeepgramGenerate).not.toHaveBeenCalled();
  });

  it('caps the characters of audio to GENERATE (cache hits are free and not counted)', async () => {
    const text = buildStory(6);
    const paras = paragraphsOf(text);
    const per = preprocessTextForTTS(paras[0]).length;
    mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([
      cacheRow(paras[0], 'default', 'edgetts', 'https://a/0.mp3'),
    ]);
    const res = await service.batchTextToSpeechForGuest(STORY_ID, text, {
      eagerCount: 0,
      maxGenerateChars: per * 2 + 1,
    });
    // 5 uncached, only 2 fit under the char budget.
    expect(res.remainingUncached).toHaveLength(2);
    expect(res.wasTruncated).toBe(true);
    // 1 cached + 2 queued = 3 servable; the 3 over the char budget are not.
    expect(res.totalParagraphs).toBe(3);
    expect(res.results.map((r) => r.index)).toContain(0);
  });

  it('authed free/paid provider selection is untouched: still a single-provider-scoped lookup', async () => {
    mockIsPremiumUser.mockResolvedValue(true);
    await service.batchTextToSpeechEager(
      STORY_ID,
      buildStory(2),
      DEFAULT_VOICE,
      'user-1',
      0,
    );
    const where =
      mockPrisma.paragraphAudioCache.findMany.mock.calls[0][0].where;
    expect(where.provider).toBe('elevenlabs');
    expect(where.voiceId).toBe(DEFAULT_VOICE);
  });
});
