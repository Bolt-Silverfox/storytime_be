import { PrismaVoiceRepository } from './prisma-voice.repository';

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
    const { repo, tx, calls } = build(1);

    const result = await repo.createUploadedVoiceWithinCap('user-1', data, 3);

    expect(calls).toEqual(['lock', 'count', 'create']);
    expect(tx.voice.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'uploaded', isDeleted: false },
    });
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
