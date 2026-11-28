import { HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createServer, connect, Server, Socket } from 'net';
import { Redis } from 'ioredis';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RedisService } from '@/redis/redis.service';
import {
  IAuthRepository,
  IAuthRepositoryTransaction,
  TokenWithUser,
} from '../repositories';
import { makeToken, makeUser } from '@/shared/testing/prisma-fixtures';
import { TokenType } from '../dto/auth.dto';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const url = process.env.RESET_REDIS_SCRATCH_URL;
const d = url ? describe : describe.skip;

d('PasswordService reset attempts against a real Redis', () => {
  const email = 'owner@rt.test';
  const owner = makeUser({ id: 'rt-owner', email });
  let client: Redis;
  let admin: Redis;
  let service: PasswordService;
  let tokens: Map<string, TokenWithUser>;
  let failWrites: boolean;
  let repository: IAuthRepository;

  const serviceOn = (redisClient: Redis) =>
    new PasswordService(
      repository,
      { emit: jest.fn() } as unknown as EventEmitter2,
      { hashToken: (code: string) => `h:${code}` } as unknown as TokenService,
      { client: redisClient } as unknown as RedisService,
    );

  const statusOf = async (work: Promise<unknown>) =>
    work.then(
      () => 200,
      (error: unknown) =>
        error instanceof HttpException ? error.getStatus() : 500,
    );

  const validate = () =>
    statusOf(
      service.validateResetToken('live', email, { token: 'live', email }),
    );
  const reset = () =>
    statusOf(
      service.resetPassword('live', email, 'NewPass1#', {
        token: 'live',
        email,
        newPassword: 'NewPass1#',
      }),
    );
  const guessWrong = () =>
    statusOf(
      service.validateResetToken('nope', email, { token: 'nope', email }),
    );

  const attemptKeys = () => admin.keys('password-reset:*');
  const waitFor = async (condition: () => boolean) => {
    for (let i = 0; i < 600 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeAll(() => {
    admin = new Redis(url!);
  });

  afterAll(async () => {
    await admin.quit();
  });

  beforeEach(async () => {
    await admin.flushdb();
    client = new Redis(url!, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 2500,
      connectionName: 'rt-reset-under-test',
    });
    await client.ping();
    failWrites = false;
    tokens = new Map([
      [
        'h:live',
        {
          ...makeToken({
            id: 'tok-live',
            userId: owner.id,
            token: 'h:live',
            type: TokenType.PASSWORD_RESET,
            expiresAt: new Date(Date.now() + 3600_000),
          }),
          user: owner,
        },
      ],
    ]);
    repository = {
      findTokenByHashedToken: (hash: string) =>
        Promise.resolve(tokens.get(hash) ?? null),
      deleteToken: (id: string) => {
        for (const [hash, t] of tokens) if (t.id === id) tokens.delete(hash);
        return Promise.resolve();
      },
      transaction: async (fn: (tx: IAuthRepositoryTransaction) => unknown) => {
        const snapshot = new Map(tokens);
        try {
          return await fn({
            consumeToken: (id: string) => {
              const found = [...tokens].find(([, t]) => t.id === id);
              if (found) tokens.delete(found[0]);
              return Promise.resolve(Boolean(found));
            },
            updateUser: () =>
              failWrites
                ? Promise.reject(new Error('db unavailable'))
                : Promise.resolve(owner),
            deleteAllUserSessions: () => Promise.resolve(),
          } as unknown as IAuthRepositoryTransaction);
        } catch (error) {
          tokens = snapshot;
          throw error;
        }
      },
      findKnownUserIP: () => Promise.resolve(null),
      recordUserIP: () => Promise.resolve(),
    } as unknown as IAuthRepository;
    service = serviceOn(client);
  });

  afterEach(() => {
    client.disconnect();
  });

  const replyProxy = async () => {
    const upstream = new URL(url!);
    const sockets: Socket[] = [];
    const held: Array<() => void> = [];
    const state = {
      mode: 'passed' as 'passed' | 'held' | 'dropped',
    };
    const proxy: Server = createServer((downstream) => {
      const server = connect(Number(upstream.port || 6379), upstream.hostname);
      sockets.push(downstream, server);
      downstream.on('data', (chunk) => server.write(chunk));
      server.on('data', (chunk) => {
        if (state.mode === 'passed') downstream.write(chunk);
        else if (state.mode === 'held')
          held.push(() => downstream.write(chunk));
      });
      downstream.on('close', () => server.destroy());
      server.on('close', () => downstream.destroy());
      downstream.on('error', () => undefined);
      server.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const { port } = proxy.address() as { port: number };
    const proxied = new Redis({
      host: '127.0.0.1',
      port,
      username: decodeURIComponent(upstream.username) || undefined,
      password: decodeURIComponent(upstream.password) || undefined,
      db: Number(upstream.pathname.slice(1) || 0),
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 300,
    });
    const close = async () => {
      proxied.disconnect();
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => proxy.close(resolve));
    };
    let startup: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        proxied.ping(),
        new Promise((_, reject) => {
          startup = setTimeout(
            () => reject(new Error('Reply proxy did not start')),
            2000,
          );
        }),
      ]);
    } catch (error) {
      await close();
      throw error;
    } finally {
      clearTimeout(startup);
    }
    return {
      client: proxied,
      get replies() {
        return state.mode;
      },
      set replies(mode: 'passed' | 'held' | 'dropped') {
        state.mode = mode;
        if (mode === 'passed') held.splice(0).forEach((flush) => flush());
      },
      reset: () => sockets.forEach((socket) => socket.destroy()),
      close,
    };
  };

  const fourWrongGuesses = async () => {
    for (let i = 0; i < 4; i++) expect(await guessWrong()).toBe(404);
  };

  it('allows five attempts per window, answers 429 after, and sets the window TTL', async () => {
    for (let i = 0; i < 5; i++) expect(await guessWrong()).toBe(404);
    expect(await validate()).toBe(429);
    const [key] = await attemptKeys();
    expect(await admin.ttl(key)).toBeGreaterThan(3500);
  });

  it('admits exactly five of twenty concurrent wrong guesses', async () => {
    const statuses = await Promise.all(
      Array.from({ length: 20 }, () => guessWrong()),
    );

    expect(statuses.filter((s) => s === 404)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it('gives a window left without a TTL an expiry on the next attempt', async () => {
    await guessWrong();
    const [key] = await attemptKeys();
    await admin.persist(key);

    await guessWrong();

    expect(await admin.pttl(key)).toBeGreaterThan(3_500_000);
  });

  it('gives a capped window left without a TTL an expiry when the cap is read', async () => {
    await guessWrong();
    const [key] = await attemptKeys();
    await admin.set(key, '5');

    expect(await validate()).toBe(429);

    expect(await admin.pttl(key)).toBeGreaterThan(3_500_000);
  });

  it('never writes the counter for a valid code whose password write rolls back, so the same code still works', async () => {
    await fourWrongGuesses();
    const [key] = await attemptKeys();
    failWrites = true;

    expect(await reset()).toBe(500);
    expect(await admin.get(key)).toBe('4');

    failWrites = false;
    expect(await reset()).toBe(200);
    expect(tokens.size).toBe(0);
  });

  it('answers 503 while replies are held back and leaves the owner able to reset afterwards', async () => {
    const link = await replyProxy();
    try {
      service = serviceOn(link.client);
      await fourWrongGuesses();
      link.replies = 'held';
      const started = Date.now();

      expect(await validate()).toBe(503);
      expect(Date.now() - started).toBeLessThan(2800);

      link.replies = 'passed';
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await reset()).toBe(200);
      expect(tokens.size).toBe(0);
      expect(await attemptKeys()).toEqual([]);
    } finally {
      await link.close();
    }
  }, 15_000);

  it('fails fast while the connection is down and lets the owner reset after reconnecting', async () => {
    await fourWrongGuesses();
    const clientId = await client.client('ID');
    await admin.call('CLIENT', 'KILL', 'ID', String(clientId));
    await waitFor(() => client.status !== 'ready');
    expect(client.status).not.toBe('ready');

    const started = Date.now();
    expect(await validate()).toBe(503);
    expect(Date.now() - started).toBeLessThan(500);

    await waitFor(() => client.status === 'ready');
    expect(client.status).toBe('ready');
    await client.ping();
    expect(await reset()).toBe(200);
    expect(tokens.size).toBe(0);
    expect(await attemptKeys()).toEqual([]);
  }, 15_000);

  it('leaves the counter alone when a valid code meets lost replies, so the code works once Redis answers again', async () => {
    const link = await replyProxy();
    try {
      service = serviceOn(link.client);
      await fourWrongGuesses();
      const [key] = await attemptKeys();
      link.replies = 'dropped';

      expect(await validate()).toBe(503);
      expect(await admin.get(key)).toBe('4');

      link.replies = 'passed';
      link.reset();
      await waitFor(() => link.client.status !== 'ready');
      await waitFor(() => link.client.status === 'ready');
      await link.client.ping();

      expect(await admin.get(key)).toBe('4');
      expect(await reset()).toBe(200);
      expect(tokens.size).toBe(0);
      expect(await attemptKeys()).toEqual([]);
    } finally {
      await link.close();
    }
  }, 30_000);
});
