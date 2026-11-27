import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type Keyv from 'keyv';
import { GuestSessionService } from './guest-session.service';
import type { IGuestRepository } from './repositories/guest.repository.interface';

const url = process.env.PASSWORDLESS_TEST_REDIS_URL;
const maybe = url ? describe : describe.skip;

maybe('GuestSessionService against real Redis', () => {
  jest.setTimeout(20_000);
  let client: Redis;
  const services: GuestSessionService[] = [];

  const instance = async () => {
    const service = new GuestSessionService(
      { get: () => url } as unknown as ConfigService,
      {} as unknown as IGuestRepository,
    );
    await service.onModuleInit();
    services.push(service);
    return service;
  };
  const lockKey = (sessionId: string) => `guest:session-lock:${sessionId}`;
  const seeded = async (service: GuestSessionService) => {
    const { sessionId } = await service.createGuestSession();
    await service.recordNewStoryAccess(sessionId, 'story-x');
    return sessionId;
  };
  const storyIds = async (service: GuestSessionService, sessionId: string) =>
    Object.keys((await service.getGuestReadingHistory(sessionId)) ?? {}).sort();

  beforeAll(() => {
    client = new Redis(url as string);
  });

  afterAll(async () => {
    for (const service of services) {
      await (service as unknown as { keyv: Keyv }).keyv.disconnect();
    }
    await client.quit();
  });

  it('round-trips a story saved under the lock through the session store', async () => {
    const service = await instance();
    const sessionId = await seeded(service);

    await expect(
      service.recordNewStoryAccess(sessionId, 'story-y'),
    ).resolves.toEqual({ recorded: true });

    expect(await storyIds(service, sessionId)).toEqual(['story-x', 'story-y']);
    expect((await service.getGuestSession(sessionId))?.uniqueStoriesRead).toBe(
      2,
    );
  });

  it('keeps a story another instance saved after the carry-over lost its lock lease', async () => {
    const retiring = await instance();
    const writer = await instance();
    const sessionId = await seeded(retiring);
    const read = retiring.getGuestSession.bind(retiring);
    jest
      .spyOn(retiring, 'getGuestSession')
      .mockImplementationOnce(async (id) => {
        const stale = await read(id);
        await client.del(lockKey(id));
        await writer.recordNewStoryAccess(id, 'story-y');
        return stale;
      });

    const result = await retiring.deleteGuestSessionIfHistoryIs(sessionId, [
      'story-x',
    ]);

    expect(result.deleted).toBe(false);
    expect(await storyIds(writer, sessionId)).toEqual(['story-x', 'story-y']);
  });

  it('does not bring back a session the carry-over retired after the writer lost its lock lease', async () => {
    const writer = await instance();
    const retiring = await instance();
    const sessionId = await seeded(writer);
    const read = writer.getGuestSession.bind(writer);
    jest.spyOn(writer, 'getGuestSession').mockImplementationOnce(async (id) => {
      const stale = await read(id);
      await client.del(lockKey(id));
      await expect(
        retiring.deleteGuestSessionIfHistoryIs(id, ['story-x']),
      ).resolves.toEqual({ deleted: true });
      return stale;
    });

    await expect(
      writer.recordNewStoryAccess(sessionId, 'story-y'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(await writer.getGuestSession(sessionId)).toBeNull();
  });

  it('refuses to save a new story while another holder keeps the lock, and saves nothing', async () => {
    const service = await instance();
    const sessionId = await seeded(service);
    await client.set(lockKey(sessionId), 'other-holder', 'PX', 10_000);

    try {
      await expect(
        service.recordNewStoryAccess(sessionId, 'story-y'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await client.del(lockKey(sessionId));
    }

    expect(await storyIds(service, sessionId)).toEqual(['story-x']);
  });

  it('still answers a re-read while another holder keeps the lock', async () => {
    const service = await instance();
    const sessionId = await seeded(service);
    await client.set(lockKey(sessionId), 'other-holder', 'PX', 10_000);

    try {
      await expect(
        service.recordNewStoryAccess(sessionId, 'story-x'),
      ).resolves.toEqual({ recorded: false, reason: 'already_read' });
    } finally {
      await client.del(lockKey(sessionId));
    }
  });
});
