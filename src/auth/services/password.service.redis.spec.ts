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

  it('refunds the slot a valid reset took when the password write rolls back, so the same code still works', async () => {
    await fourWrongGuesses();
    failWrites = true;

    expect(await reset()).toBe(500);

    failWrites = false;
    expect(await reset()).toBe(200);
    expect(tokens.size).toBe(0);
  });

  it('does not let a counter command that lands after its 503 lock the owner out', async () => {
    await fourWrongGuesses();
    await admin.call('CLIENT', 'PAUSE', '3000', 'ALL');
    const started = Date.now();

    expect(await validate()).toBe(503);
    expect(Date.now() - started).toBeLessThan(2800);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await validate()).toBe(200);
  }, 15_000);

  it('does not queue counter commands while the connection is down, so reconnecting cannot charge a 503', async () => {
    await fourWrongGuesses();
    await admin.call('CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes');
    await waitFor(() => client.status !== 'ready');
    expect(client.status).not.toBe('ready');

    const started = Date.now();
    expect(await validate()).toBe(503);
    expect(Date.now() - started).toBeLessThan(500);

    await waitFor(() => client.status === 'ready');
    expect(client.status).toBe('ready');
    await client.ping();
    expect(await validate()).toBe(200);
  }, 15_000);

  it('does not keep a charge Redis applied when its reply was lost and the 503 went out', async () => {
    const upstream = new URL(url!);
    let swallowReplies = false;
    const sockets: Socket[] = [];
    const proxy: Server = createServer((downstream) => {
      const server = connect(Number(upstream.port || 6379), upstream.hostname);
      sockets.push(downstream, server);
      downstream.on('data', (chunk) => server.write(chunk));
      server.on('data', (chunk) => {
        if (!swallowReplies) downstream.write(chunk);
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
      db: Number(upstream.pathname.slice(1) || 0),
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 300,
    });
    try {
      await proxied.ping();
      service = serviceOn(proxied);
      await fourWrongGuesses();
      const [key] = await attemptKeys();
      swallowReplies = true;

      const pending = validate();
      let applied = 0;
      for (let i = 0; i < 100 && applied < 6; i++) {
        applied = await admin.hlen(key);
        if (applied < 6) await new Promise((r) => setTimeout(r, 10));
      }
      expect(applied).toBe(6);
      expect(await pending).toBe(503);

      swallowReplies = false;
      sockets.forEach((socket) => socket.destroy());
      await waitFor(() => proxied.status !== 'ready');
      await waitFor(() => proxied.status === 'ready');
      await proxied.ping();

      expect(await admin.hlen(key)).toBe(5);
      expect(await validate()).toBe(200);
    } finally {
      proxied.disconnect();
      await new Promise((resolve) => proxy.close(resolve));
    }
  }, 30_000);
});
