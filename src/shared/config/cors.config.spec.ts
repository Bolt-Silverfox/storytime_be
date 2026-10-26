import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CORS_ALLOWED_HEADERS, corsOptions } from './cors.config';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('corsOptions', () => {
  it('allows the previously supported headers', () => {
    for (const h of [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
      'X-API-Key',
    ]) {
      expect(CORS_ALLOWED_HEADERS).toContain(h);
    }
  });

  it('allows X-Guest-Session-Id', () => {
    expect(CORS_ALLOWED_HEADERS.map((h) => h.toLowerCase())).toContain(
      'x-guest-session-id',
    );
  });

  describe('preflight', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [PingController],
      }).compile();
      app = mod.createNestApplication();
      app.enableCors(corsOptions);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers 204 and allows x-guest-session-id for the web origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', 'https://web.storytimeapp.me')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'x-guest-session-id,x-api-key');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://web.storytimeapp.me',
      );
      const allowed = String(res.headers['access-control-allow-headers'])
        .toLowerCase()
        .split(',')
        .map((s) => s.trim());
      expect(allowed).toContain('x-guest-session-id');
      expect(allowed).toContain('x-api-key');
    });

    it('does not grant CORS to a disallowed origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
