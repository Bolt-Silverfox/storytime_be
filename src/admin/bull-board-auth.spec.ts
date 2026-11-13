import type { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BullBoardModule } from '@bull-board/nestjs';
import request from 'supertest';
import { bullBoardRootOptions } from './bull-board-auth';

const USER = 'ops-admin';
const PASSWORD = 'correct-horse-battery';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function bootApp(
  user: string | undefined,
  password: string | undefined,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BullBoardModule.forRootAsync({
        useFactory: () => bullBoardRootOptions(user, password),
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

const PROTECTED_REQUESTS: Array<[string, string]> = [
  ['GET', '/api/v1/admin/queues'],
  ['GET', '/api/v1/admin/queues/'],
  ['GET', '/api/v1/admin/queues/api/queues'],
  ['GET', '/api/v1/admin/queues/static/js/main.js'],
  ['PUT', '/api/v1/admin/queues/api/queues/story/clean/completed'],
  ['PUT', '/api/v1/admin/queues/api/queues/story/job/1/retry'],
  ['DELETE', '/api/v1/admin/queues/api/queues/story/1/clean'],
];

const serverOf = (app: INestApplication) => app.getHttpServer() as Server;

const send = (app: INestApplication, method: string, path: string) =>
  request(serverOf(app))[method.toLowerCase() as 'get'](path);

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

    it('accepts a password containing a colon', async () => {
      const colonApp = await bootApp(USER, 'pa:ss');
      try {
        const res = await request(serverOf(colonApp))
          .get('/api/v1/admin/queues')
          .set('Authorization', basic(USER, 'pa:ss'));
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
});
