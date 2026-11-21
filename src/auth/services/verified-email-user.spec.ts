import { InMemoryAuthRepository } from '@/shared/testing/passwordless-fakes';
import type { IAuthRepository } from '../repositories';
import { findOrCreateParentByVerifiedEmail } from './verified-email-user';

const passwordService = { hashPassword: jest.fn().mockResolvedValue('hash') };

const asRepo = (repo: InMemoryAuthRepository) =>
  repo as unknown as IAuthRepository;

const seed = async (
  repo: InMemoryAuthRepository,
  overrides: Record<string, unknown> = {},
) => {
  const user = await repo.createUser({
    email: 'a@x.co',
    passwordHash: 'h',
    isEmailVerified: true,
    role: 'parent',
    ...overrides,
  });
  return user;
};

const uniqueViolation = (target: string[]) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target },
  });
const emailCollision = () => uniqueViolation(['email']);

describe('findOrCreateParentByVerifiedEmail', () => {
  it('resolves to the concurrently verified user when the takeover loses the race', async () => {
    const repo = new InMemoryAuthRepository();
    const real = await seed(repo);
    const stale = { ...real, isEmailVerified: false };
    repo.findUserByEmail = () => Promise.resolve(stale);

    const result = await findOrCreateParentByVerifiedEmail(
      { authRepository: asRepo(repo), passwordService },
      { email: 'a@x.co', emailVerified: true },
    );

    expect(result.isNewUser).toBe(false);
    expect(result.newlyVerified).toBe(false);
    expect(result.user.id).toBe(real.id);
  });

  it('keeps a google link made between the lookup and the sign-in write when a different google id arrives', async () => {
    const repo = new InMemoryAuthRepository();
    const real = await seed(repo);
    repo.findUserByEmail = () => {
      const snapshot = { ...real };
      real.googleId = 'g-concurrent';
      return Promise.resolve(snapshot);
    };

    await findOrCreateParentByVerifiedEmail(
      { authRepository: asRepo(repo), passwordService },
      { email: 'a@x.co', emailVerified: true, googleId: 'g-second' },
    );

    expect(real.googleId).toBe('g-concurrent');
  });

  it('links a new google id to a verified existing user', async () => {
    const repo = new InMemoryAuthRepository();
    const real = await seed(repo);

    const result = await findOrCreateParentByVerifiedEmail(
      { authRepository: asRepo(repo), passwordService },
      { email: 'a@x.co', emailVerified: true, googleId: 'g-new' },
    );

    expect(real.googleId).toBe('g-new');
    expect(result.user.googleId).toBe('g-new');
  });

  it('does not overwrite provider ids that are already set', async () => {
    const repo = new InMemoryAuthRepository();
    const real = await seed(repo, { googleId: 'g-1' });

    await findOrCreateParentByVerifiedEmail(
      { authRepository: asRepo(repo), passwordService },
      { email: 'a@x.co', emailVerified: true, googleId: 'g-2' },
    );

    expect(real.googleId).toBe('g-1');
  });

  it('resolves to the existing user when create loses a unique-violation race', async () => {
    const repo = new InMemoryAuthRepository();
    const originalCreate = repo.createUser;
    repo.createUser = async (data) => {
      await originalCreate({ ...data, email: 'a@x.co' });
      throw emailCollision();
    };

    const result = await findOrCreateParentByVerifiedEmail(
      { authRepository: asRepo(repo), passwordService },
      { email: 'a@x.co', emailVerified: true, googleId: 'g-1' },
    );

    expect(result.isNewUser).toBe(false);
    expect(result.user.email).toBe('a@x.co');
    expect(repo.users).toHaveLength(1);
  });

  it('rethrows a unique violation that persists after one retry', async () => {
    const repo = new InMemoryAuthRepository();
    const create = jest.fn().mockRejectedValue(emailCollision());
    repo.createUser = create;

    await expect(
      findOrCreateParentByVerifiedEmail(
        { authRepository: asRepo(repo), passwordService },
        { email: 'a@x.co', emailVerified: true },
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a unique violation on another column', uniqueViolation(['googleId'])],
    ['an error that is not a unique violation', new Error('connection lost')],
  ])('does not retry %s', async (_label, error) => {
    const repo = new InMemoryAuthRepository();
    const create = jest.fn().mockRejectedValue(error);
    repo.createUser = create;

    await expect(
      findOrCreateParentByVerifiedEmail(
        { authRepository: asRepo(repo), passwordService },
        { email: 'a@x.co', emailVerified: true },
      ),
    ).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
