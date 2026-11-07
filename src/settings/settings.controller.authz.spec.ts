import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import {
  ALICE,
  ALICE_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

describe('SettingsController authorization', () => {
  let app: INestApplication;
  const settings = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    setKidDailyLimit: jest.fn(),
    getKidDailyLimit: jest.fn(),
    getKidsScreenTimeSettings: jest.fn(),
    applyDefaultToAllKids: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of Object.values(settings)) fn.mockResolvedValue({});
    app = await createAuthzApp(
      [SettingsController],
      [{ provide: SettingsService, useValue: settings }],
    );
  });

  afterEach(() => app.close());

  const routes: [string, string, object][] = [
    ['get', `/settings/${ALICE}`, {}],
    ['put', `/settings/${ALICE}`, { explicitContent: true }],
    ['patch', `/settings/kid/${ALICE_KID}/daily-limit`, { limitMins: 30 }],
    ['get', `/settings/kid/${ALICE_KID}/daily-limit`, {}],
    ['get', `/settings/parent/${ALICE}/kids-limits`, {}],
    ['post', `/settings/parent/${ALICE}/apply-default-to-kids`, {}],
  ];

  const call = (method: string, url: string, body: object) =>
    (
      request(app.getHttpServer()) as never as Record<
        string,
        (u: string) => request.Test
      >
    )
      [method](url)
      .send(body);

  it.each(routes)('%s %s: anonymous 401', async (method, url, body) => {
    await call(method, url, body).expect(401);
    for (const fn of Object.values(settings)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s: other user 403', async (method, url, body) => {
    await call(method, url, body)
      .set('Authorization', bearer('bob'))
      .expect(403);
    for (const fn of Object.values(settings)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s: owner and admin 200', async (method, url, body) => {
    await call(method, url, body)
      .set('Authorization', bearer('alice'))
      .expect((res) => expect(res.status).toBeLessThan(300));
    await call(method, url, body)
      .set('Authorization', bearer('admin'))
      .expect((res) => expect(res.status).toBeLessThan(300));
  });
});
