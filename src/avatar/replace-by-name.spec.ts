import { PrismaAvatarRepository } from './repositories/prisma-avatar.repository';

describe('PrismaAvatarRepository.replaceAndAssignUserAvatar', () => {
  const build = (existing: string | null | undefined, sharing = 0) => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(`advisory:${strings.join('?')}`);
        return Promise.resolve(1);
      }),
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const text = strings.join('?');
        calls.push(`lock:${text}`);
        return Promise.resolve(
          /FROM users/.test(text) || existing === undefined
            ? []
            : [{ publicId: existing, url: 'old-url' }],
        );
      }),
      user: {
        findUnique: jest.fn(() => {
          calls.push('read-current');
          return Promise.resolve({ avatar: null });
        }),
        update: jest.fn(() => {
          calls.push('assign');
          return Promise.resolve({ id: 'u1', avatar: { id: 'row' } });
        }),
      },
      avatar: {
        count: jest.fn(() => Promise.resolve(sharing)),
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

  it('locks the owner, then the named row, upserts it and assigns it in one transaction', async () => {
    const { repo, calls } = build('old');
    const r = await repo.replaceAndAssignUserAvatar('u1', 'n', data);
    expect(calls[0]).toMatch(/FROM users.*FOR UPDATE/);
    expect(calls[1]).toBe('read-current');
    expect(calls[2]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[3]).toMatch(/FOR UPDATE/);
    expect(calls.slice(4)).toEqual(['upsert', 'assign']);
    expect(r.displacedPublicId).toBe('old');
  });

  it.each([
    ['no existing row', undefined],
    ['an existing row without an asset', null],
    ['the same asset', 'new'],
  ])('reports nothing displaced for %s', async (_n, existing) => {
    const { repo } = build(existing);
    expect(
      (await repo.replaceAndAssignUserAvatar('u1', 'n', data))
        .displacedPublicId,
    ).toBeNull();
  });

  it('does not report the old asset displaced while another avatar still references it', async () => {
    const { repo } = build('old', 1);
    expect(
      (await repo.replaceAndAssignUserAvatar('u1', 'n', data))
        .displacedPublicId,
    ).toBeNull();
  });
});
