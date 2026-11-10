import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { StoryService } from '../story/story.service';
import { TextToSpeechService } from '../story/text-to-speech.service';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceQuotaService } from './voice-quota.service';
import { TtsBatchQueueService } from './queue/tts-batch-queue.service';
import { StoryQuotaService } from '../story/story-quota.service';
import { GuestSessionService } from '@/guest/guest-session.service';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { UploadService } from '../upload/upload.service';
import { MAX_VOICE_UPLOAD_BYTES } from './voice.constants';

const ascii = (text: string) => Buffer.from(text, 'latin1');
const padded = (head: Buffer) => Buffer.concat([head, Buffer.alloc(64)]);

const MP3 = padded(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
const WAV = padded(
  Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE')]),
);
const M4A = padded(
  Buffer.concat([Buffer.from([0, 0, 0, 0x20]), ascii('ftypM4A ')]),
);
const MP4_VIDEO = padded(
  Buffer.concat([Buffer.from([0, 0, 0, 0x20]), ascii('ftypisom')]),
);
const OGG_VORBIS = padded(
  Buffer.concat([ascii('OggS'), Buffer.alloc(24), ascii('\x01vorbis')]),
);
const PNG = padded(
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
);

describe('POST /voice/upload (multer limits and allow-list)', () => {
  let app: INestApplication;
  const voiceService = { uploadVoiceFile: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    voiceService.uploadVoiceFile.mockResolvedValue({
      voice: { id: 'v1' },
      cloudinary: { url: 'u', publicId: 'p' },
    });
    const stub = {};
    const mod = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: VoiceService, useValue: voiceService },
        { provide: StoryService, useValue: stub },
        { provide: UploadService, useValue: stub },
        { provide: TextToSpeechService, useValue: stub },
        { provide: SpeechToTextService, useValue: stub },
        { provide: VoiceQuotaService, useValue: stub },
        { provide: TtsBatchQueueService, useValue: stub },
        { provide: StoryQuotaService, useValue: stub },
        { provide: GuestSessionService, useValue: stub },
        { provide: GuestStoryAudioService, useValue: stub },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          ctx.switchToHttp().getRequest().authUserData = { userId: 'user-1' };
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  const post = () =>
    request(app.getHttpServer()).post('/voice/upload').field('name', 'Dad');

  it('accepts a small mp3', async () => {
    await post()
      .attach('file', MP3, {
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);
    expect(voiceService.uploadVoiceFile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ originalname: 'a.mp3' }),
      { name: 'Dad' },
    );
  });

  it.each([
    ['wav', WAV, 'a.wav', 'audio/wav'],
    ['m4a', M4A, 'a.m4a', 'audio/x-m4a'],
    ['ogg vorbis', OGG_VORBIS, 'a.ogg', 'audio/ogg'],
  ])('accepts %s whose bytes match its type', async (_n, bytes, name, type) => {
    await post()
      .attach('file', bytes, { filename: name, contentType: type })
      .expect(201);
    expect(voiceService.uploadVoiceFile).toHaveBeenCalledTimes(1);
  });

  it('rejects with 422 a file whose bytes are not audio despite an audio name and mime', async () => {
    await post()
      .attach('file', PNG, { filename: 'a.mp3', contentType: 'audio/mpeg' })
      .expect(422);
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });

  it('rejects with 422 an mp4 container that the content check does not accept', async () => {
    await post()
      .attach('file', MP4_VIDEO, {
        filename: 'a.m4a',
        contentType: 'audio/mp4',
      })
      .expect(422);
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });

  it.each([
    ['a.mp4', 'audio/mp4'],
    ['a.webm', 'audio/webm'],
  ])(
    'rejects %s with 415 because the content check cannot accept it',
    async (filename, contentType) => {
      await post().attach('file', MP3, { filename, contentType }).expect(415);
      expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
    },
  );

  it('rejects a file over the size limit with 413 without calling the service', async () => {
    await post()
      .attach('file', Buffer.alloc(MAX_VOICE_UPLOAD_BYTES + 1), {
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(413);
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });

  it('rejects a non-audio mime type with 415', async () => {
    await post()
      .attach('file', MP3, {
        filename: 'a.mp3',
        contentType: 'application/x-msdownload',
      })
      .expect(415);
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });

  it('rejects a non-audio extension even with an audio mime type with 415', async () => {
    await post()
      .attach('file', MP3, {
        filename: 'a.exe',
        contentType: 'audio/mpeg',
      })
      .expect(415);
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });

  it('rejects more than one file', async () => {
    const res = await post()
      .attach('file', MP3, {
        filename: 'a.mp3',
        contentType: 'audio/mpeg',
      })
      .attach('file', MP3, {
        filename: 'b.mp3',
        contentType: 'audio/mpeg',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Too many files');
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });
});
