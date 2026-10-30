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

const UUID = 'nimbus-voice-uuid';

describe('TextToSpeechService authed default-voice cache reuse', () => {
  let service: TextToSpeechService;
  let rows: ReturnType<typeof cacheRow>[];

  const mockUploadAudio = jest.fn();
  const mockElevenLabsGenerate = jest.fn();
  const mockDeepgramGenerate = jest.fn();
  const mockEdgeTtsGenerate = jest.fn();
  const mockIsPremiumUser = jest.fn();
  const mockCanFreeUserUseElevenLabs = jest.fn();
  const mockCanUseVoiceForStory = jest.fn();

  // Stateful fake honouring voiceId (exact or {in}), provider and textHash.
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
    rows = [];
    mockPrisma.paragraphAudioCache.findMany.mockImplementation(
      ({ where }: { where: any }) =>
        Promise.resolve(
          rows.filter(
            (r) =>
              r.storyId === where.storyId &&
              (typeof where.voiceId === 'string'
                ? r.voiceId === where.voiceId
                : where.voiceId.in.includes(r.voiceId)) &&
              (!where.provider || r.provider === where.provider) &&
              where.textHash.in.includes(r.textHash),
          ),
        ),
    );
    mockPrisma.voice.findMany.mockResolvedValue([{ id: UUID }]);
    mockPrisma.paragraphAudioCache.findFirst.mockResolvedValue(null);
    mockPrisma.paragraphAudioCache.upsert.mockResolvedValue({});
    mockPrisma.voice.findFirst.mockResolvedValue(null);
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

  const text = buildStory(2);
  const paras = paragraphsOf(text);

  it.each([
    ['NIMBUS name', DEFAULT_VOICE],
    ['voice UUID', UUID],
    ['ElevenLabs alias id', DEFAULT_EL_ID],
    ['default placeholder', 'default'],
  ])(
    'reuses a guest-generated NIMBUS/deepgram row for a free user sending the %s',
    async (_label, voiceId) => {
      rows = paras.map((p, i) =>
        cacheRow(p, DEFAULT_VOICE, 'deepgram', `https://g/${i}.mp3`),
      );
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);

      const res = await service.batchTextToSpeechEager(
        STORY_ID,
        text,
        voiceId,
        'user-1',
      );

      expect(res.results.map((r) => r.audioUrl)).toEqual([
        'https://g/0.mp3',
        'https://g/1.mp3',
      ]);
      expect(mockDeepgramGenerate).not.toHaveBeenCalled();
      expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
      expect(mockElevenLabsGenerate).not.toHaveBeenCalled();
      expect(mockUploadAudio).not.toHaveBeenCalled();
    },
  );

  it('still misses for a non-default voice (no cross-voice reuse)', async () => {
    rows = paras.map((p, i) =>
      cacheRow(p, DEFAULT_VOICE, 'deepgram', `https://g/${i}.mp3`),
    );
    mockIsPremiumUser.mockResolvedValue(false);
    mockCanFreeUserUseElevenLabs.mockResolvedValue(false);

    const res = await service.batchTextToSpeechEager(
      STORY_ID,
      text,
      'MILO',
      'user-1',
    );

    expect(res.results.map((r) => r.audioUrl)).not.toContain('https://g/0.mp3');
    expect(
      mockDeepgramGenerate.mock.calls.length +
        mockEdgeTtsGenerate.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("reuses old rows under 'default', 'LILY', the NIMBUS name and the UUID regardless of age (never regenerate)", async () => {
    const ancient = new Date('2026-01-01T00:00:00Z');
    const aliasRows = [
      cacheRow(paras[0], 'default', 'elevenlabs', 'https://o/0.mp3'),
      cacheRow(paras[1], 'LILY', 'edgetts', 'https://o/1.mp3'),
    ].map((r) => ({ ...r, createdAt: ancient }));
    rows = aliasRows;
    mockIsPremiumUser.mockResolvedValue(false);
    mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
    const res = await service.batchTextToSpeechEager(
      STORY_ID,
      text,
      DEFAULT_VOICE,
      'user-1',
    );
    expect(res.results.map((r) => r.audioUrl)).toEqual([
      'https://o/0.mp3',
      'https://o/1.mp3',
    ]);
    expect(mockDeepgramGenerate).not.toHaveBeenCalled();
    expect(mockEdgeTtsGenerate).not.toHaveBeenCalled();
  });
});
