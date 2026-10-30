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

  describe('legacy default aliases are only served from when that provider produced the current Nimbus voice', () => {
    const at = (iso: string) => new Date(iso);
    const dated = (
      text0: string,
      voiceId: string,
      provider: string,
      when: Date,
      url: string,
    ) => ({ ...cacheRow(text0, voiceId, provider, url), createdAt: when });
    const run = async () => {
      mockIsPremiumUser.mockResolvedValue(false);
      mockCanFreeUserUseElevenLabs.mockResolvedValue(false);
      const res = await service.batchTextToSpeechEager(
        STORY_ID,
        text,
        DEFAULT_VOICE,
        'user-1',
      );
      return res.results.map((r) => r.audioUrl);
    };

    it("legacy 'LILY' ElevenLabs row from before 360506b (old ElevenLabs id) is not served; a later one is", async () => {
      rows = [
        dated(
          paras[0],
          'LILY',
          'elevenlabs',
          at('2026-02-23T22:35:21Z'),
          'https://el/old.mp3',
        ),
        dated(
          paras[1],
          'LILY',
          'elevenlabs',
          at('2026-02-23T22:35:23Z'),
          'https://el/new.mp3',
        ),
      ];
      const urls = await run();
      expect(urls).not.toContain('https://el/old.mp3');
      expect(urls).toContain('https://el/new.mp3');
    });

    it("'default' rows: served once the default was LILY AND the provider voice was current (per provider)", async () => {
      rows = [
        // ElevenLabs: default became LILY on 02-22 but the Nimbus id only on 02-23T22:35Z
        dated(
          paras[0],
          'default',
          'elevenlabs',
          at('2026-02-23T12:00:00Z'),
          'https://el/early.mp3',
        ),
        // Edge: Ava is current, default became LILY 02-22T16:13Z
        dated(
          paras[1],
          'default',
          'edgetts',
          at('2026-02-22T17:00:00Z'),
          'https://edge/ok.mp3',
        ),
        // Edge row from while the default was still CHARLIE (Andrew)
        dated(
          paras[1],
          'default',
          'edgetts',
          at('2026-02-22T10:00:00Z'),
          'https://edge/charlie.mp3',
        ),
      ];
      const urls = await run();
      expect(urls).not.toContain('https://el/early.mp3');
      expect(urls).not.toContain('https://edge/charlie.mp3');
      expect(urls).toContain('https://edge/ok.mp3');
    });

    it("a 'default' row after the provider cutoff but BEFORE the NIMBUS rename commit is served", async () => {
      rows = paras.map((p, i) =>
        dated(
          p,
          'default',
          'elevenlabs',
          at('2026-02-25T00:00:00Z'),
          `https://el/${i}.mp3`,
        ),
      );
      expect(await run()).toEqual(['https://el/0.mp3', 'https://el/1.mp3']);
    });

    it("'default' Deepgram rows only count after hera became the Deepgram voice (3080ad5)", async () => {
      rows = [
        dated(
          paras[0],
          'default',
          'deepgram',
          at('2026-02-24T22:00:00Z'),
          'https://dg/early.mp3',
        ),
        dated(
          paras[1],
          'default',
          'deepgram',
          at('2026-02-24T23:00:00Z'),
          'https://dg/ok.mp3',
        ),
      ];
      const urls = await run();
      expect(urls).not.toContain('https://dg/early.mp3');
      expect(urls).toContain('https://dg/ok.mp3');
    });

    it('NIMBUS-name and UUID rows are always served regardless of age', async () => {
      const ancient = at('2026-01-01T00:00:00Z');
      rows = [
        dated(
          paras[0],
          DEFAULT_VOICE,
          'elevenlabs',
          ancient,
          'https://o/0.mp3',
        ),
        dated(paras[1], UUID, 'unknown', ancient, 'https://o/1.mp3'),
      ];
      expect(await run()).toEqual(['https://o/0.mp3', 'https://o/1.mp3']);
    });
  });
});
