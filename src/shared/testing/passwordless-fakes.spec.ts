import { InMemoryAuthRepository } from './passwordless-fakes';

describe('InMemoryAuthRepository.createUser', () => {
  it('keeps provider ids and the profile country it is given', async () => {
    const repo = new InMemoryAuthRepository();

    const user = await repo.createUser({
      email: 'a@example.com',
      passwordHash: 'h',
      googleId: 'g-1',
      appleId: 'a-1',
      profile: { create: { country: 'GH' } },
    });

    expect(user.googleId).toBe('g-1');
    expect(user.appleId).toBe('a-1');
    expect(user.profile?.country).toBe('GH');
  });

  it('defaults to no provider ids and NG', async () => {
    const user = await new InMemoryAuthRepository().createUser({
      email: 'b@example.com',
      passwordHash: 'h',
    });

    expect(user.googleId).toBeNull();
    expect(user.appleId).toBeNull();
    expect(user.profile?.country).toBe('NG');
  });
});
