import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { isSwaggerEnabled, setupSwagger } from './swagger.config';

describe('isSwaggerEnabled', () => {
  it('is on in development and staging', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'staging' })).toBe(true);
  });

  it('is off in production by default', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is off when NODE_ENV is unset, matching the production default', () => {
    expect(isSwaggerEnabled({})).toBe(false);
  });

  it('is on in production only when SWAGGER_ENABLED is exactly "true"', () => {
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'TRUE' }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: '1' }),
    ).toBe(false);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }),
    ).toBe(false);
  });
});

describe('setupSwagger', () => {
  const makeApp = async (env: NodeJS.ProcessEnv) => {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication();
    const enabled = setupSwagger(app, env);
    await app.init();
    return { app, enabled };
  };
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('serves /docs-json outside production', async () => {
    const made = await makeApp({ NODE_ENV: 'development' });
    app = made.app;

    expect(made.enabled).toBe(true);
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/docs-json')
      .expect(200);
  });

  it('does not serve /docs or /docs-json in production', async () => {
    const made = await makeApp({ NODE_ENV: 'production' });
    app = made.app;
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    expect(made.enabled).toBe(false);
    await request(server).get('/docs').expect(404);
    await request(server).get('/docs-json').expect(404);
  });
});
