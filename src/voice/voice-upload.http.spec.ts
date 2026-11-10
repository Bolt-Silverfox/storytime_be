import {
  FileTypeValidator,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
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

const MP3 = Buffer.concat([
  Buffer.from([0xff, 0xfb, 0x90, 0x00]),
  Buffer.alloc(64),
]);

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
    jest.spyOn(FileTypeValidator.prototype, 'isValid').mockResolvedValue(true);
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
    expect(voiceService.uploadVoiceFile).not.toHaveBeenCalled();
  });
});
