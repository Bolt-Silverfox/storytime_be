import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { GuestStoryAudioController } from './guest-story-audio.controller';
import { GuestStoryAudioService } from './guest-story-audio.service';
import { GUEST_AUDIO_THROTTLE } from '@/shared/constants/guest-audio.constants';
import { throttleConfig } from '@/shared/config/throttle.config';

const STORY = '24fe8886-f166-4073-a173-636873caac31';
const sessionN = (n: number) =>
  `3f0c6a7e-1b2d-4c3e-8f4a-5b6c7d8e${String(n).padStart(4, '0')}`;

describe('Guest audio HTTP (real ThrottlerGuard + ValidationPipe, mocked service)', () => {
  let app: INestApplication;
  const service = { start: jest.fn(), status: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    service.start.mockResolvedValue({ statusCode: 200, paragraphs: [] });
    service.status.mockResolvedValue({ status: 'processing' });
    const mod = await Test.createTestingModule({
      imports: [
        // Same named throttlers / values the app uses in production.
        ThrottlerModule.forRoot({ throttlers: throttleConfig.throttlers }),
      ],
      controllers: [GuestStoryAudioController],
      providers: [
        { provide: GuestStoryAudioService, useValue: service },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    // Mirrors main.ts: forbidNonWhitelisted would 400 unknown fields.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(() => app.close());

  it('POST accepts a client voiceId but never forwards it; empty body is fine', async () => {
    await request(app.getHttpServer())
      .post(`/guest/stories/${STORY}/audio`)
      .set('x-guest-session-id', sessionN(1))
      .send({ voiceId: 'SOMETHING_ELSE' })
      .expect(201);
    expect(service.start).toHaveBeenCalledWith(STORY, sessionN(1));
    await request(app.getHttpServer())
      .post(`/guest/stories/${STORY}/audio`)
      .set('x-guest-session-id', sessionN(1))
      .expect(201);
  });

  it('rejects non-UUID story ids and unknown body fields (400)', async () => {
    await request(app.getHttpServer())
      .post('/guest/stories/not-a-uuid/audio')
      .set('x-guest-session-id', sessionN(1))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/guest/stories/${STORY}/audio`)
      .set('x-guest-session-id', sessionN(1))
      .send({ textContent: 'free tts please' })
      .expect(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('throttles a SINGLE guest session after the per-session limit, while another session is unaffected', async () => {
    const limit = GUEST_AUDIO_THROTTLE.start.perSession.limit;
    const hit = (s: string) =>
      request(app.getHttpServer())
        .post(`/guest/stories/${STORY}/audio`)
        .set('x-guest-session-id', s);
    for (let i = 0; i < limit; i++) await hit(sessionN(2)).expect(201);
    await hit(sessionN(2)).expect(429);
    await hit(sessionN(3)).expect(201);
  });

  it('throttles per IP across rotating sessions after the per-minute IP limit', async () => {
    const limit = GUEST_AUDIO_THROTTLE.start.ipPerMinute.limit;
    let throttledAt = -1;
    for (let i = 0; i < limit + 2 && throttledAt < 0; i++) {
      // a fresh session each time: the per-session limit never trips
      const res = await request(app.getHttpServer())
        .post(`/guest/stories/${STORY}/audio`)
        .set('x-guest-session-id', sessionN(100 + i));
      if (res.status === 429) throttledAt = i;
    }
    expect(throttledAt).toBe(limit);
  });

  it('status polling from one IP is not cut off by the default medium (50/10s) limit', async () => {
    const batch = '0b9d6f0e-33d2-4b0a-8c1f-1a2b3c4d5e6f';
    // All at once so every request lands in the same 10 s throttle window.
    const responses = await Promise.all(
      Array.from({ length: 60 }, () =>
        request(app.getHttpServer())
          .get(`/guest/stories/${STORY}/audio/${batch}`)
          .set('x-guest-session-id', sessionN(500)),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(60).fill(200));
  });
});
