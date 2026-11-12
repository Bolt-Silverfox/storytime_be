import {
  InMemoryAuthRepository,
  InMemoryLoginChallengeRepository,
  InMemoryRedis,
} from './passwordless-fakes';
import { AmbiguousEmailAccountError } from '@/auth/repositories/ambiguous-email-account.error';
import {
  DECR_CLAMPED,
  INCR_WITH_EXPIRY,
} from '@/auth/services/passwordless-throttle.service';

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

describe('InMemoryLoginChallengeRepository.deleteExpiredBefore boundary', () => {
  it('keeps a row that expires exactly at the cutoff', async () => {
    const repo = new InMemoryLoginChallengeRepository();
    await repo.replaceOpenChallenge({
      ...challenge('edge', 0),
      expiresAt: minutes(10),
    });

    expect(await repo.deleteExpiredBefore(minutes(10), 5)).toBe(0);
    expect(await repo.deleteExpiredBefore(minutes(11), 5)).toBe(1);
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

describe('InMemoryAuthRepository.findUserByEmailInsensitive', () => {
  const seed = async (
    repo: InMemoryAuthRepository,
    email: string,
    isEmailVerified: boolean,
    ageMinutes: number,
  ) => {
    const user = await repo.createUser({
      email,
      passwordHash: 'h',
      isEmailVerified,
    });
    user.createdAt = new Date(NOW.getTime() - ageMinutes * 60_000);
    return user;
  };

  it('prefers the only verified match over an exact-case unverified one', async () => {
    const repo = new InMemoryAuthRepository();
    await seed(repo, 'case@x.co', false, 30);
    const verified = await seed(repo, 'CASE@x.co', true, 20);

    const found = await repo.findUserByEmailInsensitive('case@x.co');

    expect(found?.id).toBe(verified.id);
  });

  it('prefers an exact-case verified match over an older verified variant', async () => {
    const repo = new InMemoryAuthRepository();
    await seed(repo, 'a@x.co', true, 30);
    const exact = await seed(repo, 'A@x.co', true, 10);

    const found = await repo.findUserByEmailInsensitive('A@x.co');

    expect(found?.id).toBe(exact.id);
  });

  it('refuses when several verified variants match and none is the exact case', async () => {
    const repo = new InMemoryAuthRepository();
    await seed(repo, 'a@x.co', true, 30);
    await seed(repo, 'A@x.co', true, 20);

    await expect(repo.findUserByEmailInsensitive('A@X.co')).rejects.toThrow(
      AmbiguousEmailAccountError,
    );
  });

  it('falls back to the exact-case match, then the oldest', async () => {
    const repo = new InMemoryAuthRepository();
    const oldest = await seed(repo, 'Case@x.co', false, 30);
    const exact = await seed(repo, 'case@x.co', false, 10);

    expect((await repo.findUserByEmailInsensitive('case@x.co'))?.id).toBe(
      exact.id,
    );
    expect((await repo.findUserByEmailInsensitive('CASE@X.CO'))?.id).toBe(
      oldest.id,
    );
  });

  it('returns null when nothing matches', async () => {
    expect(
      await new InMemoryAuthRepository().findUserByEmailInsensitive('n@x.co'),
    ).toBeNull();
  });
});

describe('InMemoryAuthRepository.linkGoogleAccountIfUnset with a session', () => {
  const setup = async () => {
    const repo = new InMemoryAuthRepository();
    const user = await repo.createUser({
      email: 'a@x.co',
      passwordHash: 'h',
      isEmailVerified: true,
    });
    const other = await repo.createUser({
      email: 'b@x.co',
      passwordHash: 'h',
      isEmailVerified: true,
    });
    const session = await repo.createSession({
      userId: user.id,
      token: 't',
      expiresAt: minutes(60),
    });
    return { repo, user, other, session };
  };

  it('links when the session belongs to the user', async () => {
    const { repo, user, session } = await setup();

    const result = await repo.linkGoogleAccountIfUnset(
      user.id,
      'g1',
      session.id,
    );

    expect(result).toEqual({ count: 1 });
    expect(user.googleId).toBe('g1');
  });

  it('does not link when the session no longer exists', async () => {
    const { repo, user, session } = await setup();
    await repo.deleteAllUserSessions(user.id);

    const result = await repo.linkGoogleAccountIfUnset(
      user.id,
      'g1',
      session.id,
    );

    expect(result).toEqual({ count: 0 });
    expect(user.googleId).toBeNull();
  });

  it('does not link when the session belongs to another user', async () => {
    const { repo, other, session } = await setup();

    const result = await repo.linkAppleAccountIfUnset(
      other.id,
      'ap1',
      session.id,
    );

    expect(result).toEqual({ count: 0 });
    expect(other.appleId).toBeNull();
  });
});

describe('InMemoryAuthRepository sessions', () => {
  const data = (userId: string) => ({
    userId,
    token: 't',
    expiresAt: minutes(60),
  });

  it('does not reuse the id of a deleted session', async () => {
    const repo = new InMemoryAuthRepository();
    const first = await repo.createSession(data('u1'));
    await repo.deleteAllUserSessions('u1');

    const second = await repo.createSession(data('u1'));

    expect(second.id).not.toBe(first.id);
  });

  it('does not link through a soft-revoked session', async () => {
    const repo = new InMemoryAuthRepository();
    const user = await repo.createUser({
      email: 'a@x.co',
      passwordHash: 'h',
      isEmailVerified: true,
    });
    const session = await repo.createSession(data(user.id));
    session.isDeleted = true;

    const result = await repo.linkGoogleAccountIfUnset(
      user.id,
      'g1',
      session.id,
    );

    expect(result).toEqual({ count: 0 });
  });
});

describe('InMemoryRedis expiry', () => {
  afterEach(() => jest.useRealTimers());

  it('starts a fresh window when a released counter goes from 0 back to 1', async () => {
    jest.useFakeTimers({ now: NOW });
    const { client } = new InMemoryRedis();
    await client.eval(INCR_WITH_EXPIRY, 1, 'k', '1000');
    jest.advanceTimersByTime(900);
    await client.eval(DECR_CLAMPED, 1, 'k', '1000');
    await client.eval(INCR_WITH_EXPIRY, 1, 'k', '1000');

    jest.advanceTimersByTime(200);

    expect(await client.get('k')).toBe('1');
  });
});

describe('InMemoryRedis', () => {
  it('rejects a Lua script it does not know', async () => {
    await expect(
      new InMemoryRedis().client.eval('return 1', 1, 'k', '1000'),
    ).rejects.toThrow('InMemoryRedis: unknown Lua script');
  });
});
