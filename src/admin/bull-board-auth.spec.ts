import type { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BullBoardModule } from '@bull-board/nestjs';
import request from 'supertest';
import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type { Request, Response } from 'express';
import {
  bullBoardOptionsFromConfig,
  bullBoardRootOptions,
  createBullBoardAuth,
} from './bull-board-auth';

const USER = 'ops-admin';
const PASSWORD = 'correct-horse-battery-staple-9f2k';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const stubQueue = {
  name: 'stub',
  metaValues: { version: 'bullmq:5.0.0' },
  pause: jest.fn().mockResolvedValue(undefined),
  getJobCounts: jest.fn().mockResolvedValue({}),
  isPaused: jest.fn().mockResolvedValue(false),
  getGlobalConcurrency: jest.fn().mockResolvedValue(null),
  getRateLimitTtl: jest.fn().mockResolvedValue(0),
  getJobSchedulersCount: jest.fn().mockResolvedValue(0),
  getJobs: jest.fn().mockResolvedValue([]),
};

async function bootApp(
  user: string | undefined,
  password: string | undefined,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BullBoardModule.forRootAsync({
        useFactory: () => bullBoardRootOptions(user, password),
      }),
      BullBoardModule.forFeature({
        name: 'stub',
        queue: stubQueue,
        adapter: BullMQAdapter,
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  let nextClient = 0;
  app.use((req: Request, _res: Response, next: () => void) => {
    req.headers['x-forwarded-for'] ??= `10.1.0.${++nextClient}`;
    next();
  });
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

const PROTECTED_REQUESTS: Array<[string, string]> = [
  ['GET', '/api/v1/admin/queues'],
  ['GET', '/api/v1/admin/queues/'],
  ['GET', '/api/v1/admin/queues/api/queues'],
  ['GET', '/api/v1/admin/queues/static/js/main.js'],
  ['HEAD', '/api/v1/admin/queues/api/queues'],
  ['POST', '/api/v1/admin/queues/api/queues/stub/add'],
  ['PUT', '/api/v1/admin/queues/api/queues/stub/pause'],
  ['PUT', '/api/v1/admin/queues/api/queues/stub/retry/failed'],
  ['PUT', '/api/v1/admin/queues/api/queues/stub/clean/completed'],
  ['PUT', '/api/v1/admin/queues/api/queues/stub/obliterate'],
];

const serverOf = (app: INestApplication) => app.getHttpServer() as Server;

const send = (app: INestApplication, method: string, path: string) =>
  request(serverOf(app))[method.toLowerCase() as 'get'](path);

const SHORT_PASSWORD = 'a'.repeat(23);

describe('Bull Board basic auth', () => {
  describe('credentials configured', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp(USER, PASSWORD);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(PROTECTED_REQUESTS)(
      'rejects %s %s without credentials with 401 and a challenge',
      async (method, path) => {
        const res = await send(app, method, path);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/^Basic realm=/);
      },
    );

    it.each(PROTECTED_REQUESTS)(
      'rejects %s %s with a wrong password',
      async (method, path) => {
        const res = await send(app, method, path).set(
          'Authorization',
          basic(USER, 'wrong'),
        );
        expect(res.status).toBe(401);
      },
    );

    it('rejects a wrong username with the right password', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues')
        .set('Authorization', basic('someone', PASSWORD));
      expect(res.status).toBe(401);
    });

    it('rejects a Bearer token', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues/api/queues')
        .set('Authorization', 'Bearer abc');
      expect(res.status).toBe(401);
    });

    it('rejects a credential that only shares a prefix with the password', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues')
        .set('Authorization', basic(USER, `${PASSWORD}x`));
      expect(res.status).toBe(401);
    });

    it('serves the HTML dashboard with the right credentials', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues')
        .set('Authorization', basic(USER, PASSWORD));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    });

    it('serves the JSON queue endpoint with the right credentials', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues/api/queues')
        .set('Authorization', basic(USER, PASSWORD));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('queues');
    });

    it('reaches a real action handler with the right credentials', async () => {
      stubQueue.pause.mockClear();
      const res = await request(serverOf(app))
        .put('/api/v1/admin/queues/api/queues/stub/pause')
        .set('Authorization', basic(USER, PASSWORD));
      expect(res.status).toBe(200);
      expect(stubQueue.pause).toHaveBeenCalledTimes(1);
    });

    it('does not run the action handler without credentials', async () => {
      stubQueue.pause.mockClear();
      await request(serverOf(app)).put(
        '/api/v1/admin/queues/api/queues/stub/pause',
      );
      expect(stubQueue.pause).not.toHaveBeenCalled();
    });

    it('accepts a password containing a colon', async () => {
      const colonPassword = `${PASSWORD}:with:colons`;
      const colonApp = await bootApp(USER, colonPassword);
      try {
        const res = await request(serverOf(colonApp))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, colonPassword));
        expect(res.status).toBe(200);
      } finally {
        await colonApp.close();
      }
    });
  });

  describe.each([
    ['both unset', undefined, undefined],
    ['user unset', undefined, PASSWORD],
    ['password unset', USER, undefined],
    ['both empty', '', ''],
    ['password blank', USER, '   '],
    ['password 23 chars', USER, SHORT_PASSWORD],
    ['password 23 chars plus padding', USER, `  ${SHORT_PASSWORD}\n`],
  ])('credentials missing (%s)', (_label, user, password) => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp(user, password);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(PROTECTED_REQUESTS)(
      'does not serve %s %s',
      async (method, path) => {
        const res = await send(app, method, path);
        expect(res.status).toBe(404);
      },
    );

    it('does not serve the dashboard even when credentials are sent', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues')
        .set('Authorization', basic(USER, PASSWORD));
      expect(res.status).toBe(404);
    });

    it('does not serve the dashboard to empty credentials', async () => {
      const res = await request(serverOf(app))
        .get('/api/v1/admin/queues/api/queues')
        .set('Authorization', basic('', ''));
      expect(res.status).toBe(404);
    });
  });

  describe('password length floor', () => {
    it('serves a password of exactly 24 characters', async () => {
      const password = 'b'.repeat(24);
      const exactApp = await bootApp(USER, password);
      try {
        const res = await request(serverOf(exactApp))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, password));
        expect(res.status).toBe(200);
      } finally {
        await exactApp.close();
      }
    });

    it('warns at boot about a short password without printing it', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        bullBoardRootOptions(USER, SHORT_PASSWORD);
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0][0]);
        expect(message).toContain('BULL_BOARD_PASSWORD');
        expect(message).not.toContain(SHORT_PASSWORD);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn for a long enough password', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        bullBoardRootOptions(USER, PASSWORD);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('trimmed configuration', () => {
    it('matches credentials when the configured values carry trailing whitespace', async () => {
      const paddedApp = await bootApp(`${USER}\n`, `${PASSWORD}\n`);
      try {
        const res = await request(serverOf(paddedApp))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, PASSWORD));
        expect(res.status).toBe(200);
      } finally {
        await paddedApp.close();
      }
    });
  });

  describe('ConfigService wiring', () => {
    const bootWithConfig = async (values: Record<string, string>) => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => values] }),
        ],
      }).compile();
      const config = moduleRef.get(ConfigService);
      const app = await Test.createTestingModule({
        imports: [
          BullBoardModule.forRootAsync({
            useFactory: () => bullBoardOptionsFromConfig(config),
          }),
        ],
      }).compile();
      const nest = app.createNestApplication();
      nest.setGlobalPrefix('api/v1');
      await nest.init();
      return nest;
    };

    it('reads BULL_BOARD_USER and BULL_BOARD_PASSWORD', async () => {
      const app = await bootWithConfig({
        BULL_BOARD_USER: USER,
        BULL_BOARD_PASSWORD: PASSWORD,
      });
      try {
        const ok = await request(serverOf(app))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, PASSWORD));
        expect(ok.status).toBe(200);
        const bad = await request(serverOf(app))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, 'wrong'));
        expect(bad.status).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('fails closed when the config keys are misnamed', async () => {
      const app = await bootWithConfig({
        BULLBOARD_USER: USER,
        BULLBOARD_PASSWORD: PASSWORD,
      });
      try {
        const res = await request(serverOf(app))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, PASSWORD));
        expect(res.status).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe('failed-attempt limiter over HTTP', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp(USER, PASSWORD);
    });
    afterAll(async () => {
      await app.close();
    });

    const guess = (ip: string, password: string) =>
      request(serverOf(app))
        .get('/api/v1/admin/queues/api/queues')
        .set('X-Forwarded-For', ip)
        .set('Authorization', basic(USER, password));

    it('answers the 11th bad attempt from one address with 429 and still serves another address', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await guess('203.0.113.7', `wrong-${i}`)).status).toBe(401);
      }
      const blocked = await guess('203.0.113.7', 'wrong-10');
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect((await guess('203.0.113.8', PASSWORD)).status).toBe(200);
    });
  });

  describe('failed-attempt limiter', () => {
    const FAILURE_LIMIT = 10;
    const WINDOW_MS = 15 * 60 * 1000;

    interface FakeRes {
      statusCode?: number;
      headers: Record<string, string>;
      res: Response;
    }

    const fakeRes = (): FakeRes => {
      const out: FakeRes = { headers: {}, res: undefined as never };
      out.res = {
        set: (name: string, value: string) => {
          out.headers[name] = value;
          return out.res;
        },
        status: (code: number) => {
          out.statusCode = code;
          return out.res;
        },
        end: () => out.res,
      } as unknown as Response;
      return out;
    };

    const attempt = (
      middleware: ReturnType<typeof createBullBoardAuth>,
      ip: string,
      password: string | null,
    ) => {
      const out = fakeRes();
      const next = jest.fn();
      middleware(
        {
          ip,
          headers:
            password === null ? {} : { authorization: basic(USER, password) },
        } as unknown as Request,
        out.res,
        next,
      );
      return { out, next };
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('answers 401 for ten bad attempts then 429 with Retry-After', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT; i++) {
        expect(attempt(middleware, '1.1.1.1', 'wrong').out.statusCode).toBe(
          401,
        );
      }
      const blocked = attempt(middleware, '1.1.1.1', 'wrong');
      expect(blocked.out.statusCode).toBe(429);
      expect(Number(blocked.out.headers['Retry-After'])).toBeGreaterThan(0);
    });

    it('keeps refusing the blocked address even with the right password', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT; i++) {
        attempt(middleware, '1.1.1.1', 'wrong');
      }
      const result = attempt(middleware, '1.1.1.1', PASSWORD);
      expect(result.out.statusCode).toBe(429);
      expect(result.next).not.toHaveBeenCalled();
    });

    it('still serves correct credentials from another address', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT + 1; i++) {
        attempt(middleware, '1.1.1.1', 'wrong');
      }
      const result = attempt(middleware, '2.2.2.2', PASSWORD);
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    it('does not count successes or credential-less requests as failures', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT * 2; i++) {
        attempt(middleware, '1.1.1.1', null);
        expect(
          attempt(middleware, '1.1.1.1', PASSWORD).next,
        ).toHaveBeenCalled();
      }
      expect(attempt(middleware, '1.1.1.1', 'wrong').out.statusCode).toBe(401);
    });

    it('does not let a success reset the failure count', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT - 1; i++) {
        attempt(middleware, '1.1.1.1', 'wrong');
      }
      attempt(middleware, '1.1.1.1', PASSWORD);
      attempt(middleware, '1.1.1.1', 'wrong');
      expect(attempt(middleware, '1.1.1.1', 'wrong').out.statusCode).toBe(429);
    });

    it('forgets the failures once the window has passed', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT + 1; i++) {
        attempt(middleware, '1.1.1.1', 'wrong');
      }
      jest.advanceTimersByTime(WINDOW_MS + 1);
      expect(attempt(middleware, '1.1.1.1', PASSWORD).next).toHaveBeenCalled();
      expect(attempt(middleware, '1.1.1.1', 'wrong').out.statusCode).toBe(401);
    });

    it('stays bounded when many addresses fail once each', () => {
      const middleware = createBullBoardAuth(USER, PASSWORD);
      for (let i = 0; i < 5000; i++) {
        attempt(middleware, `10.0.${Math.floor(i / 250)}.${i % 250}`, 'wrong');
      }
      const result = attempt(middleware, '9.9.9.9', 'wrong');
      expect(result.out.statusCode).toBe(401);
    });

    it('does not rate limit when the dashboard is not configured', () => {
      const middleware = createBullBoardAuth(USER, SHORT_PASSWORD);
      for (let i = 0; i < FAILURE_LIMIT + 2; i++) {
        expect(attempt(middleware, '1.1.1.1', 'wrong').out.statusCode).toBe(
          404,
        );
      }
    });
  });
});
