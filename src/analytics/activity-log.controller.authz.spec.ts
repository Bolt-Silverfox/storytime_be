import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ActivityLogController } from './activity-log.controller';
import { AnalyticsService } from './analytics.service';
import {
  ALICE,
  ALICE_KID,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const LOG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('ActivityLogController authorization', () => {
  let app: INestApplication;
  const analytics = {
    create: jest.fn(),
    getForUser: jest.fn(),
    getForKid: jest.fn(),
    getById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    analytics.create.mockImplementation((dto) =>
      Promise.resolve({
        id: LOG_ID,
        ...dto,
      }),
    );
    analytics.getForUser.mockResolvedValue([]);
    analytics.getForKid.mockResolvedValue([]);
    analytics.getById.mockResolvedValue({ id: LOG_ID, userId: ALICE });
    app = await createAuthzApp(
      [ActivityLogController],
      [{ provide: AnalyticsService, useValue: analytics }],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  it.each([
    ['GET', `/activity-logs/user/${ALICE}`],
    ['GET', `/activity-logs/kid/${ALICE_KID}`],
    ['GET', `/activity-logs/${LOG_ID}`],
    ['POST', '/activity-logs'],
  ])('%s %s rejects anonymous callers with 401', async (method, url) => {
    const req = method === 'GET' ? http().get(url) : http().post(url);
    await req.send({ action: 'A', status: 'S' }).expect(401);
    expect(analytics.create).not.toHaveBeenCalled();
    expect(analytics.getForUser).not.toHaveBeenCalled();
    expect(analytics.getForKid).not.toHaveBeenCalled();
    expect(analytics.getById).not.toHaveBeenCalled();
  });

  it("refuses another parent's user logs and allows self and admin", async () => {
    await http()
      .get(`/activity-logs/user/${ALICE}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/activity-logs/user/${ALICE}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/activity-logs/user/${ALICE}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it("refuses another parent's kid logs and allows the kid's parent and admin", async () => {
    await http()
      .get(`/activity-logs/kid/${ALICE_KID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/activity-logs/kid/${ALICE_KID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/activity-logs/kid/${ALICE_KID}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it('checks the owner of a single log by id', async () => {
    await http()
      .get(`/activity-logs/${LOG_ID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/activity-logs/${LOG_ID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/activity-logs/${LOG_ID}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it('forges nothing: a log created for another user is refused, an own log is bound to the session', async () => {
    await http()
      .post('/activity-logs')
      .set('Authorization', bearer('alice'))
      .send({ userId: BOB, action: 'PASSWORD_CHANGED', status: 'SUCCESS' })
      .expect(403);
    await http()
      .post('/activity-logs')
      .set('Authorization', bearer('alice'))
      .send({ kidId: BOB_KID, action: 'A', status: 'S' })
      .expect(403);
    expect(analytics.create).not.toHaveBeenCalled();

    await http()
      .post('/activity-logs')
      .set('Authorization', bearer('alice'))
      .send({ action: 'START_STORY', status: 'SUCCESS' })
      .expect(201);
    expect(analytics.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ALICE }),
    );
  });
});
