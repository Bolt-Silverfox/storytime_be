import { retireAvatarIfUnreferenced } from './retire-avatar';

describe('retireAvatarIfUnreferenced', () => {
  const build = (
    row: { publicId: string | null; isSystemAvatar: boolean } | null,
    users: number,
    kids: number,
    deleted = 1,
  ) => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        calls.push(`lock:${strings.join('?')}`);
        return Promise.resolve(row ? [row] : []);
      }),
      user: {
        count: jest.fn(() => {
          calls.push('count');
          return Promise.resolve(users);
        }),
      },
      kid: { count: jest.fn(() => Promise.resolve(kids)) },
      avatar: {
        deleteMany: jest.fn(() => {
          calls.push('delete');
          return Promise.resolve({ count: deleted });
        }),
      },
    };
    return { tx, calls };
  };
  const retire = (tx: unknown) =>
    retireAvatarIfUnreferenced(tx as never, 'old');

  it('locks the avatar row before counting and deleting', async () => {
    const { tx, calls } = build(
      { publicId: 'asset', isSystemAvatar: false },
      0,
      0,
    );
    await expect(retire(tx)).resolves.toBe('asset');
    expect(calls[0]).toMatch(/FOR UPDATE/);
    expect(calls.slice(1)).toEqual(['count', 'delete']);
  });

  it.each([
    [1, 0],
    [0, 1],
  ])('keeps the avatar while %i users and %i kids use it', async (u, k) => {
    const { tx } = build({ publicId: 'asset', isSystemAvatar: false }, u, k);
    await expect(retire(tx)).resolves.toBeNull();
    expect(tx.avatar.deleteMany).not.toHaveBeenCalled();
  });

  it('never retires a system avatar', async () => {
    const { tx } = build({ publicId: 'asset', isSystemAvatar: true }, 0, 0);
    await expect(retire(tx)).resolves.toBeNull();
    expect(tx.avatar.deleteMany).not.toHaveBeenCalled();
  });

  it('returns null when the row is gone or the delete removed nothing', async () => {
    await expect(retire(build(null, 0, 0).tx)).resolves.toBeNull();
    const { tx } = build({ publicId: 'asset', isSystemAvatar: false }, 0, 0, 0);
    await expect(retire(tx)).resolves.toBeNull();
  });

  it('returns null for an avatar that has no stored asset', async () => {
    const { tx } = build({ publicId: null, isSystemAvatar: false }, 0, 0);
    await expect(retire(tx)).resolves.toBeNull();
  });
});
