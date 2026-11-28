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
import {
  ScratchRedisEndpoint,
  scratchRedisEndpoint,
} from '@/shared/testing/scratch-redis';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const url = process.env.RESET_REDIS_SCRATCH_URL;
const d = url ? describe : describe.skip;

d('PasswordService reset attempts against a real Redis', () => {
  const email = 'owner@rt.test';
  const owner = makeUser({ id: 'rt-owner', email });
  let client: Redis | undefined;
  let tokenId: string;
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

  const counterKey = () => `password-reset:token-failures:${tokenId}`;
  const waitFor = async (condition: () => boolean) => {
    for (let i = 0; i < 600 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  const runId = `${process.pid}-${Date.now()}`;
  const unrelatedKey = `unrelated:${runId}`;
  let testNumber = 0;
  let endpoint: ScratchRedisEndpoint;

  const withinDeadline = async <T>(work: Promise<T>, what: string) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${what} did not answer within 2s`)),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const assertOnScratchDb = async (connection: Redis, what: string) => {
    const info = String(
      await withinDeadline(connection.call('CLIENT', 'INFO'), what),
    );
    if (/(?:^| )db=(\d+)/.exec(info)?.[1] !== String(endpoint.db)) {
      throw new Error(`${what} is not on the scratch database`);
    }
  };

  beforeAll(async () => {
    endpoint = scratchRedisEndpoint(url!);
    admin = new Redis({ ...endpoint, commandTimeout: 2000 });
    await assertOnScratchDb(admin, 'Admin connection');
    if ((await admin.set(unrelatedKey, 'kept', 'EX', 600)) !== 'OK') {
      throw new Error('Sentinel key was not written');
    }
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.del(unrelatedKey);
    } finally {
      admin.disconnect();
    }
  });

  beforeEach(async () => {
    tokenId = `tok-${runId}-${++testNumber}`;
    client = new Redis({
      ...endpoint,
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 2500,
      connectionName: 'rt-reset-under-test',
    });
    await assertOnScratchDb(client, 'Client under test');
    failWrites = false;
    tokens = new Map([
      [
        'h:live',
        {
          ...makeToken({
            id: tokenId,
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
      findTokensByUserEmail: (owner: string) =>
        Promise.resolve(
          [...tokens.values()].filter(
            (t) => t.user.email.toLowerCase() === owner.toLowerCase(),
          ),
        ),
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

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (tokenId) await admin.del(counterKey());
  });

  const replyProxy = async () => {
    const sockets: Socket[] = [];
    const held: Array<() => void> = [];
    const state = {
      mode: 'passed' as 'passed' | 'held' | 'dropped',
    };
    const proxy: Server = createServer((downstream) => {
      const server = connect(endpoint.port, endpoint.host);
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
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', () => {
        proxy.off('error', reject);
        resolve();
      });
    });
    const { port } = proxy.address() as { port: number };
    const proxied = new Redis({
      host: '127.0.0.1',
      port,
      username: endpoint.username,
      password: endpoint.password,
      db: endpoint.db,
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 300,
    });
    const close = async () => {
      proxied.disconnect();
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => proxy.close(resolve));
    };
    try {
      await assertOnScratchDb(proxied, 'Reply proxy');
    } catch (error) {
      await close();
      throw error;
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

  it('burns the code after five wrong guesses and sets the window TTL', async () => {
    for (let i = 0; i < 5; i++) expect(await guessWrong()).toBe(404);
    expect(tokens.size).toBe(0);
    expect(await validate()).toBe(404);
    const key = counterKey();
    expect(await admin.ttl(key)).toBeGreaterThan(3500);
    expect(await admin.ttl(key)).toBeLessThanOrEqual(3600);
  });

  it('counts every one of twenty concurrent wrong guesses against the code and burns it', async () => {
    const statuses = await Promise.all(
      Array.from({ length: 20 }, () => guessWrong()),
    );

    expect(statuses.every((s) => s === 404)).toBe(true);
    const key = counterKey();
    expect(await admin.get(key)).toBe('20');
    expect(tokens.size).toBe(0);
  });

  it('gives a window left without a TTL an expiry on the next attempt', async () => {
    await guessWrong();
    const key = counterKey();
    expect(await admin.persist(key)).toBe(1);
    expect(await admin.pttl(key)).toBe(-1);

    await guessWrong();

    expect(await admin.pttl(key)).toBeGreaterThan(3_500_000);
    expect(await admin.pttl(key)).toBeLessThanOrEqual(3_600_000);
  });

  it('gives a window left without a TTL an expiry when a valid code reads it', async () => {
    await guessWrong();
    const key = counterKey();
    expect(await admin.set(key, '4')).toBe('OK');
    expect(await admin.pttl(key)).toBe(-1);
    failWrites = true;

    expect(await reset()).toBe(500);

    expect(await admin.pttl(key)).toBeGreaterThan(3_500_000);
    expect(await admin.pttl(key)).toBeLessThanOrEqual(3_600_000);
  });

  it('never writes the counter for a valid code whose password write rolls back, so the same code still works', async () => {
    await fourWrongGuesses();
    const key = counterKey();
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
      expect(await admin.exists(counterKey())).toBe(0);
    } finally {
      await link.close();
    }
  }, 15_000);

  it('fails fast while the connection is down and lets the owner reset after reconnecting', async () => {
    const underTest = client!;
    await fourWrongGuesses();
    const clientId = await underTest.client('ID');
    expect(await admin.call('CLIENT', 'KILL', 'ID', String(clientId))).toBe(1);
    await waitFor(() => underTest.status !== 'ready');
    expect(underTest.status).not.toBe('ready');

    const started = Date.now();
    expect(await validate()).toBe(503);
    expect(Date.now() - started).toBeLessThan(500);

    await waitFor(() => underTest.status === 'ready');
    expect(underTest.status).toBe('ready');
    await assertOnScratchDb(underTest, 'Reconnected client');
    expect(await reset()).toBe(200);
    expect(tokens.size).toBe(0);
    expect(await admin.exists(counterKey())).toBe(0);
  }, 15_000);

  it('leaves the counter alone when a valid code meets lost replies, so the code works once Redis answers again', async () => {
    const link = await replyProxy();
    try {
      service = serviceOn(link.client);
      await fourWrongGuesses();
      const key = counterKey();
      link.replies = 'dropped';

      expect(await validate()).toBe(503);
      expect(await admin.get(key)).toBe('4');

      link.replies = 'passed';
      link.reset();
      await waitFor(() => link.client.status !== 'ready');
      await waitFor(() => link.client.status === 'ready');
      await assertOnScratchDb(link.client, 'Reconnected proxy client');

      expect(await admin.get(key)).toBe('4');
      expect(await reset()).toBe(200);
      expect(tokens.size).toBe(0);
      expect(await admin.exists(counterKey())).toBe(0);
    } finally {
      await link.close();
    }
  }, 30_000);

  it('leaves keys it does not own in the scratch database', async () => {
    expect(await admin.get(unrelatedKey)).toBe('kept');
  });
});
