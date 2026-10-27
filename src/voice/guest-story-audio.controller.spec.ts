import 'reflect-metadata';
import { GuestStoryAudioController } from './guest-story-audio.controller';
import { GUEST_AUDIO_THROTTLE } from '@/shared/constants/guest-audio.constants';
import { IS_PUBLIC_KEY } from '@/shared/decorators/public.decorator';

const meta = (key: string, handler: object): unknown =>
  Reflect.getMetadata(key, handler);

describe('GuestStoryAudioController', () => {
  const service = { start: jest.fn(), status: jest.fn() };
  const controller = new GuestStoryAudioController(service as never);
  const SESSION = '3f0c6a7e-1b2d-4c3e-8f4a-5b6c7d8e9f01';
  const STORY = '24fe8886-f166-4073-a173-636873caac31';

  beforeEach(() => jest.clearAllMocks());

  it('mounts under guest/stories and is public (guests have no JWT)', () => {
    expect(Reflect.getMetadata('path', GuestStoryAudioController)).toBe(
      'guest/stories',
    );
    for (const h of [controller.startAudio, controller.getAudioStatus]) {
      expect(meta(IS_PUBLIC_KEY, h)).toBe(true);
    }
    expect(Reflect.getMetadata('path', controller.startAudio)).toBe(
      ':storyId/audio',
    );
    expect(Reflect.getMetadata('method', controller.startAudio)).toBe(1); // POST
    expect(Reflect.getMetadata('path', controller.getAudioStatus)).toBe(
      ':storyId/audio/:batchJobId',
    );
    expect(Reflect.getMetadata('method', controller.getAudioStatus)).toBe(0); // GET
  });

  it('carries per-IP (short + medium) and per-session (long) throttle metadata on the start route', async () => {
    const t = GUEST_AUDIO_THROTTLE.start;
    const h = controller.startAudio;
    expect(meta('THROTTLER:LIMITshort', h)).toBe(t.ipPerMinute.limit);
    expect(meta('THROTTLER:TTLshort', h)).toBe(t.ipPerMinute.ttl);
    expect(meta('THROTTLER:LIMITmedium', h)).toBe(t.ipPerHour.limit);
    expect(meta('THROTTLER:TTLmedium', h)).toBe(t.ipPerHour.ttl);
    expect(meta('THROTTLER:LIMITlong', h)).toBe(t.perSession.limit);
    expect(meta('THROTTLER:TTLlong', h)).toBe(t.perSession.ttl);
    const tracker = meta('THROTTLER:TRACKERlong', h) as (
      r: Record<string, unknown>,
    ) => Promise<string>;
    expect(
      await tracker({
        headers: { 'x-guest-session-id': SESSION },
        ip: '1.2.3.4',
      }),
    ).toBe(`guest-session:${SESSION}`);
    // Missing header falls back to the IP so the route is never un-throttled.
    expect(await tracker({ headers: {}, ip: '1.2.3.4' })).toBe('1.2.3.4');
    // The IP-scoped throttlers keep the default (IP) tracker.
    expect(meta('THROTTLER:TRACKERshort', h)).toBeUndefined();
    expect(meta('THROTTLER:TRACKERmedium', h)).toBeUndefined();
  });

  it('carries throttle metadata on the status route', () => {
    const t = GUEST_AUDIO_THROTTLE.status;
    const h = controller.getAudioStatus;
    expect(meta('THROTTLER:LIMITshort', h)).toBe(t.ipPerMinute.limit);
    expect(meta('THROTTLER:LIMITlong', h)).toBe(t.perSession.limit);
    expect(meta('THROTTLER:TTLlong', h)).toBe(t.perSession.ttl);
    expect(typeof meta('THROTTLER:TRACKERlong', h)).toBe('function');
  });

  it('delegates start with the header session id and body', async () => {
    service.start.mockResolvedValue({ ok: true });
    const out = await controller.startAudio(STORY, { voiceId: 'x' }, SESSION);
    expect(service.start).toHaveBeenCalledWith(STORY, SESSION, {
      voiceId: 'x',
    });
    expect(out).toEqual({ ok: true });
  });

  it('delegates status with the header session id', async () => {
    service.status.mockResolvedValue({ status: 'processing' });
    const out = await controller.getAudioStatus(
      STORY,
      '0b9d6f0e-33d2-4b0a-8c1f-1a2b3c4d5e6f',
      SESSION,
    );
    expect(service.status).toHaveBeenCalledWith(
      '0b9d6f0e-33d2-4b0a-8c1f-1a2b3c4d5e6f',
      SESSION,
    );
    expect(out).toEqual({ status: 'processing' });
  });
});
