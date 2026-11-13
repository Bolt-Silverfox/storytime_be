import { PrismaUserRepository } from './prisma-user.repository';

describe('PrismaUserRepository.createAndAssignAvatar', () => {
  const build = (
    usersUsing: number,
    kidsUsing: number,
    oldRow: { publicId: string | null; isSystemAvatar: boolean } | null = {
      publicId: 'old-asset',
      isSystemAvatar: false,
    },
  ) => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn(() => {
        calls.push('lock');
        return Promise.resolve(oldRow ? [oldRow] : []);
      }),
      user: {
        findUnique: jest.fn().mockResolvedValue({ avatarId: 'old' }),
        update: jest.fn(() => {
          calls.push('assign');
          return Promise.resolve({ id: 'u1', avatarId: 'new' });
        }),
        count: jest.fn(() => {
          calls.push('count');
          return Promise.resolve(usersUsing);
        }),
      },
      kid: { count: jest.fn().mockResolvedValue(kidsUsing) },
      avatar: {
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    return { tx, calls, repo: new PrismaUserRepository(prisma as never) };
  };

  it('returns the retired asset id when nothing else references the old avatar', async () => {
    const { repo, tx } = build(0, 0);
    const result = await repo.createAndAssignAvatar('u1', 'url', 'pid');
    expect(result.retiredPublicId).toBe('old-asset');
    expect(result.user).toMatchObject({ id: 'u1' });
    expect(tx.avatar.deleteMany).toHaveBeenCalledWith({
      where: { id: 'old', isSystemAvatar: false },
    });
  });

  it('locks and counts only after the owner has been moved to the new avatar', async () => {
    const { repo, calls } = build(0, 0);
    await repo.createAndAssignAvatar('u1', 'url', 'pid');
    expect(calls).toEqual(['assign', 'lock', 'count']);
  });

  it.each([
    [1, 0],
    [0, 1],
  ])(
    'keeps the previous avatar and reports no asset while %i users and %i kids use it',
    async (users, kids) => {
      const { repo, tx } = build(users, kids);
      const result = await repo.createAndAssignAvatar('u1', 'url', 'pid');
      expect(result.retiredPublicId).toBeNull();
      expect(tx.avatar.deleteMany).not.toHaveBeenCalled();
    },
  );
});
