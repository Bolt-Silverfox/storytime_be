import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { bearer, createAuthzApp } from '@/shared/testing/authz-harness';

describe('AnalyticsController authorization', () => {
  let app: INestApplication;
  const analytics = { getStats: jest.fn().mockResolvedValue({ userCount: 1 }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await createAuthzApp(
      [AnalyticsController],
      [{ provide: AnalyticsService, useValue: analytics }],
    );
  });

  afterEach(() => app.close());

  const get = () => request(app.getHttpServer()).get('/analytics/stats');

  it('rejects anonymous callers with 401', async () => {
    await get().expect(401);
    expect(analytics.getStats).not.toHaveBeenCalled();
  });

  it('rejects non-admin users with 403', async () => {
    await get().set('Authorization', bearer('alice')).expect(403);
    expect(analytics.getStats).not.toHaveBeenCalled();
  });

  it('serves admins', async () => {
    await get().set('Authorization', bearer('admin')).expect(200);
  });
});
