import {
  InMemoryAuthRepository,
  InMemoryLoginChallengeRepository,
} from './passwordless-fakes';

const NOW = new Date('2026-01-01T00:00:00Z');
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

const challenge = (id: string, createdAtMinutes: number, email = 'a@x.co') => ({
  id,
  emailNormalized: email,
  codeHash: `code-${id}`,
  linkTokenHash: `link-${id}`,
  expiresAt: minutes(60),
  requestIpHash: null,
  now: minutes(createdAtMinutes),
});

describe('InMemoryLoginChallengeRepository.deleteExpiredBefore', () => {
  it('removes at most limit expired rows per call and reports the removed count', async () => {
    const repo = new InMemoryLoginChallengeRepository();
    for (let i = 0; i < 5; i += 1) {
      await repo.replaceOpenChallenge({
        ...challenge(`c${i}`, 0, `u${i}@x.co`),
        expiresAt: minutes(1),
      });
    }
    const cutoff = minutes(10);

    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(repo.rows).toHaveLength(3);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(2);
    expect(await repo.deleteExpiredBefore(cutoff, 2)).toBe(1);
    expect(repo.rows).toHaveLength(0);
  });
});

describe('InMemoryLoginChallengeRepository.findOpenIdByEmail', () => {
  it('returns null when the newest open row is exhausted even if an older one has attempts left', async () => {
    const repo = new InMemoryLoginChallengeRepository();
    await repo.replaceOpenChallenge(challenge('older', 0));
    await repo.replaceOpenChallenge(challenge('newer', 1));
    repo.rows.find((r) => r.id === 'older')!.invalidatedAt = null;
    repo.rows.find((r) => r.id === 'newer')!.attempts = 5;

    expect(await repo.findOpenIdByEmail('a@x.co', minutes(2))).toBeNull();
  });

  it('returns the newest open row while it has attempts left', async () => {
    const repo = new InMemoryLoginChallengeRepository();
    await repo.replaceOpenChallenge(challenge('only', 0));

    expect(await repo.findOpenIdByEmail('a@x.co', minutes(2))).toBe('only');
  });
});

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
