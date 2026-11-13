import { PrismaUserRepository } from './prisma-user.repository';

describe('PrismaUserRepository.createAndAssignAvatar', () => {
  const build = (usersUsing: number, kidsUsing: number) => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ avatarId: 'old' }),
        update: jest.fn().mockResolvedValue({ id: 'u1', avatarId: 'new' }),
        count: jest.fn().mockResolvedValue(usersUsing),
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
    return {
      tx,
      repo: new PrismaUserRepository(prisma as never),
    };
  };

  it('deletes the previous custom avatar when nothing else references it', async () => {
    const { repo, tx } = build(0, 0);
    await repo.createAndAssignAvatar('u1', 'url', 'pid');
    expect(tx.avatar.deleteMany).toHaveBeenCalledWith({
      where: { id: 'old', isSystemAvatar: false },
    });
  });

  it.each([
    [1, 0],
    [0, 1],
  ])(
    'keeps the previous avatar row while %i users and %i kids still use it',
    async (users, kids) => {
      const { repo, tx } = build(users, kids);
      await repo.createAndAssignAvatar('u1', 'url', 'pid');
      expect(tx.avatar.deleteMany).not.toHaveBeenCalled();
    },
  );
});
