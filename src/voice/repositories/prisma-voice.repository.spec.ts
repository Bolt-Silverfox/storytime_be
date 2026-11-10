import { PrismaVoiceRepository } from './prisma-voice.repository';
import { PENDING_VOICE_GRACE_MS } from '../voice.constants';

const NOW = new Date('2026-01-01T12:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - PENDING_VOICE_GRACE_MS);

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PrismaVoiceRepository.createUploadedVoiceWithinCap', () => {
  const data = {
    userId: 'user-1',
    name: 'Dad',
    type: 'uploaded',
  };

  function build(count: number) {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve(1);
      }),
      voice: {
        deleteMany: jest.fn().mockImplementation(() => {
          calls.push('sweep');
          return Promise.resolve({ count: 0 });
        }),
        count: jest.fn().mockImplementation(() => {
          calls.push('count');
          return Promise.resolve(count);
        }),
        create: jest.fn().mockImplementation(() => {
          calls.push('create');
          return Promise.resolve({ id: 'v1', ...data });
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return {
      repo: new PrismaVoiceRepository(prisma as never),
      tx,
      calls,
    };
  }

  it('takes the per-user lock before counting and creating', async () => {
    const { repo, calls } = build(1);

    const result = await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(calls).toEqual(['lock', 'sweep', 'count', 'create']);
    expect(result).toEqual(expect.objectContaining({ id: 'v1' }));
  });

  it('keys the advisory lock on the user id', async () => {
    const { repo, tx } = build(0);

    await repo.createUploadedVoiceWithinCap('user-1', data, 3);
    await repo.createUploadedVoiceWithinCap('user-2', data, 3);

    const keys = tx.$executeRaw.mock.calls.map(
      (call: unknown[]) => call[1] as string,
    );
    expect(keys).toEqual(['voice-upload:user-1', 'voice-upload:user-2']);
  });

  it('counts completed voices and pending ones inside the grace window only', async () => {
    const { repo, tx } = build(0);

    await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(tx.voice.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'uploaded',
        isDeleted: false,
        OR: [{ url: { not: null } }, { createdAt: { gte: CUTOFF } }],
      },
    });
  });

  it('sweeps only this user stale pending uploads before counting', async () => {
    const { repo, tx } = build(0);

    await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(tx.voice.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'uploaded',
        url: null,
        createdAt: { lt: CUTOFF },
      },
    });
  });

  it('creates the reservation when the user is one below the cap', async () => {
    const { repo, tx } = build(2);

    const result = await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(tx.voice.create).toHaveBeenCalledWith({ data });
    expect(result).toEqual(expect.objectContaining({ id: 'v1' }));
  });

  it('returns null and creates nothing when the user is at the cap', async () => {
    const { repo, tx } = build(3);

    const result = await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(result).toBeNull();
    expect(tx.voice.create).not.toHaveBeenCalled();
  });

  it('returns null for a zero cap', async () => {
    const { repo, tx } = build(0);

    expect(
      await repo.createUploadedVoiceWithinCap('user-1', data, 0),
    ).toBeNull();
    expect(tx.voice.create).not.toHaveBeenCalled();
  });
});

describe('PrismaVoiceRepository pending upload visibility', () => {
  const hidesPending = { NOT: { type: 'uploaded', url: null } };

  function build() {
    const voice = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    };
    return {
      repo: new PrismaVoiceRepository({ voice } as never),
      voice,
    };
  }

  it('hides pending uploads from the user listing', async () => {
    const { repo, voice } = build();

    await repo.findManyByUserNotDeleted('user-1');

    expect(voice.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isDeleted: false, ...hidesPending },
    });
  });

  it('hides pending uploads from lookup by id', async () => {
    const { repo, voice } = build();

    await repo.findFirstByIdNotDeleted('v1');

    expect(voice.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', isDeleted: false, ...hidesPending },
    });
  });

  it('hides pending uploads from unique lookup by id', async () => {
    const { repo, voice } = build();

    await repo.findUniqueByIdNotDeleted('v1');

    expect(voice.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', isDeleted: false, ...hidesPending },
    });
  });

  it('hides pending uploads from the elevenlabs id lookup', async () => {
    const { repo, voice } = build();

    await repo.findElevenLabsIdById('v1');

    expect(voice.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', isDeleted: false, ...hidesPending },
      select: { elevenLabsVoiceId: true },
    });
  });
});
