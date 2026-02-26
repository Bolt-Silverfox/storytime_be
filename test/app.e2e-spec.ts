import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

// Skip e2e tests when required env vars are not set (CI without .env)
const hasEnv = !!process.env.ELEVEN_LABS_KEY;

const describeIfEnv = hasEnv ? describe : describe.skip;

describeIfEnv('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Dynamic import to avoid env validation at module load time
    const { AppModule } = await import('./../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
