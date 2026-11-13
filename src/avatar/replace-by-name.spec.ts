import { PrismaAvatarRepository } from './repositories/prisma-avatar.repository';

describe('PrismaAvatarRepository.replaceByName', () => {
  const build = (existing: string | null | undefined) => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(`lock:${strings.join('?')}`);
        return Promise.resolve(
          existing === undefined ? [] : [{ publicId: existing }],
        );
      }),
      avatar: {
        upsert: jest.fn(({ create }: { create: { publicId: string } }) => {
          calls.push('upsert');
          return Promise.resolve({ id: 'row', publicId: create.publicId });
        }),
      },
    };
    const prisma = {
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    return { calls, repo: new PrismaAvatarRepository(prisma as never) };
  };
  const data = { url: 'u', publicId: 'new', isSystemAvatar: false };

  it('locks the named row before upserting and reports what it displaced', async () => {
    const { repo, calls } = build('old');
    const r = await repo.replaceByName('n', data);
    expect(calls[0]).toMatch(/FOR UPDATE/);
    expect(calls[1]).toBe('upsert');
    expect(r.displacedPublicId).toBe('old');
  });

  it.each([
    ['no existing row', undefined],
    ['an existing row without an asset', null],
    ['the same asset', 'new'],
  ])('reports nothing displaced for %s', async (_n, existing) => {
    const { repo } = build(existing);
    expect((await repo.replaceByName('n', data)).displacedPublicId).toBeNull();
  });
});
