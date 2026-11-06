import type { User, Profile, Avatar, Session } from '@prisma/client';
import type {
  ILoginChallengeRepository,
  NewLoginChallenge,
} from '@/auth/repositories/login-challenge.repository.interface';
import type { IAuthRepository } from '@/auth/repositories';

interface Row {
  id: string;
  emailNormalized: string;
  codeHash: string;
  linkTokenHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  requestIpHash: string | null;
  createdAt: Date;
}

export class InMemoryLoginChallengeRepository implements ILoginChallengeRepository {
  rows: Row[] = [];

  private isOpen(r: Row, now: Date): boolean {
    return (
      r.consumedAt === null &&
      r.invalidatedAt === null &&
      r.attempts < r.maxAttempts &&
      r.expiresAt.getTime() > now.getTime()
    );
  }

  replaceOpenChallenge(data: NewLoginChallenge): Promise<void> {
    for (const r of this.rows) {
      if (
        r.emailNormalized === data.emailNormalized &&
        r.consumedAt === null &&
        r.invalidatedAt === null
      ) {
        r.invalidatedAt = data.now;
      }
    }
    this.rows.push({
      id: data.id,
      emailNormalized: data.emailNormalized,
      codeHash: data.codeHash,
      linkTokenHash: data.linkTokenHash,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: data.expiresAt,
      consumedAt: null,
      invalidatedAt: null,
      requestIpHash: data.requestIpHash,
      createdAt: data.now,
    });
    return Promise.resolve();
  }

  findOpenIdByEmail(email: string, now: Date): Promise<string | null> {
    const open = this.rows
      .filter((r) => r.emailNormalized === email && this.isOpen(r, now))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(open[0]?.id ?? null);
  }

  recordAttempt(id: string, now: Date): Promise<{ codeHash: string } | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r || !this.isOpen(r, now)) return Promise.resolve(null);
    r.attempts += 1;
    return Promise.resolve({ codeHash: r.codeHash });
  }

  consumeById(id: string, now: Date): Promise<string | null> {
    const r = this.rows.find((x) => x.id === id);
    if (
      !r ||
      r.consumedAt !== null ||
      r.invalidatedAt !== null ||
      r.expiresAt.getTime() <= now.getTime()
    ) {
      return Promise.resolve(null);
    }
    r.consumedAt = now;
    return Promise.resolve(r.emailNormalized);
  }

  consumeByLinkTokenHash(hash: string, now: Date): Promise<string | null> {
    const r = this.rows.find((x) => x.linkTokenHash === hash);
    return r ? this.consumeById(r.id, now) : Promise.resolve(null);
  }

  deleteExpiredBefore(cutoff: Date, _limit: number): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => r.expiresAt.getTime() >= cutoff.getTime(),
    );
    return Promise.resolve(before - this.rows.length);
  }
}

export class InMemoryRedis {
  private store = new Map<string, { n: number; expiresAt: number }>();
  down = false;

  client = {
    get: (key: string): Promise<string | null> => {
      if (this.down) return Promise.reject(new Error('redis down'));
      const cur = this.store.get(key);
      return Promise.resolve(
        cur && cur.expiresAt > Date.now() ? String(cur.n) : null,
      );
    },
    eval: (
      _script: string,
      _numKeys: number,
      key: string,
      ttlMs: string,
    ): Promise<number> => {
      if (this.down) return Promise.reject(new Error('redis down'));
      const now = Date.now();
      const cur = this.store.get(key);
      if (!cur || cur.expiresAt <= now) {
        this.store.set(key, { n: 1, expiresAt: now + Number(ttlMs) });
        return Promise.resolve(1);
      }
      cur.n += 1;
      return Promise.resolve(cur.n);
    },
    set: (
      key: string,
      _value: string,
      _ex: string,
      ttl: number,
    ): Promise<string | null> => {
      if (this.down) return Promise.reject(new Error('redis down'));
      const now = Date.now();
      const cur = this.store.get(key);
      if (cur && cur.expiresAt > now) return Promise.resolve(null);
      this.store.set(key, { n: 1, expiresAt: now + ttl * 1000 });
      return Promise.resolve('OK');
    },
  };
}

export class InMemoryAuthRepository {
  users: Array<User & { profile: Profile | null; avatar: Avatar | null }> = [];
  sessions: Session[] = [];
  created: Array<Record<string, unknown>> = [];

  findUserByEmail = (email: string) =>
    Promise.resolve(this.users.find((u) => u.email === email) ?? null);

  updateUserWithRelations = (id: string, data: Partial<User>) => {
    const u = this.users.find((x) => x.id === id)!;
    Object.assign(u, data);
    return Promise.resolve(u);
  };

  createUser = (data: Record<string, unknown>) => {
    this.created.push(data);
    const u = {
      id: `user-${this.users.length + 1}`,
      email: data.email as string,
      passwordHash: data.passwordHash as string,
      hasLocalPassword: false,
      name: (data.name as string) ?? null,
      avatarId: null,
      isEmailVerified: data.isEmailVerified === true,
      onboardingStatus:
        (data.onboardingStatus as User['onboardingStatus']) ??
        'account_created',
      role: data.role as User['role'],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      pinHash: null,
      biometricsEnabled: false,
      isSuspended: false,
      suspendedAt: null,
      isDeleted: false,
      deletedAt: null,
      googleId: null,
      appleId: null,
      profile: { country: 'NG' } as Profile,
      avatar: null,
    } as unknown as User & { profile: Profile | null; avatar: Avatar | null };
    this.users.push(u);
    return Promise.resolve(u);
  };

  findUserByEmailInsensitive = (email: string) =>
    Promise.resolve(
      this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ??
        null,
    );

  deleteAllUserSessions = (userId: string) => {
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    return Promise.resolve();
  };

  countKidsByParentId = () => Promise.resolve(0);

  createSession = (data: {
    userId: string;
    token: string;
    expiresAt: Date;
  }) => {
    const s = { id: `session-${this.sessions.length + 1}`, ...data } as Session;
    this.sessions.push(s);
    return Promise.resolve(s);
  };

  recordLastLogin = () => Promise.resolve();
}

export type FakeAuthRepo = InMemoryAuthRepository & Partial<IAuthRepository>;
