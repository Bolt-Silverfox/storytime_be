import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ScreenTimeService } from './services/screen-time.service';
import {
  ALICE,
  ALICE_KID,
  BOB,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const SESSION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('ReportsController authorization', () => {
  let app: INestApplication;
  const reports = {
    getWeeklyOverview: jest.fn(),
    getKidDetailedReport: jest.fn(),
    recordAnswer: jest.fn(),
  };
  const screenTime = {
    startScreenTimeSession: jest.fn(),
    endScreenTimeSession: jest.fn(),
    getDailyLimitStatus: jest.fn(),
    getSessionKidId: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    reports.getWeeklyOverview.mockResolvedValue({});
    reports.getKidDetailedReport.mockResolvedValue({});
    screenTime.getDailyLimitStatus.mockResolvedValue({});
    screenTime.getSessionKidId.mockResolvedValue(ALICE_KID);
    screenTime.endScreenTimeSession.mockResolvedValue({});
    app = await createAuthzApp(
      [ReportsController],
      [
        { provide: ReportsService, useValue: reports },
        { provide: ScreenTimeService, useValue: screenTime },
      ],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  it.each([
    ['get', `/reports/weekly/${ALICE}`],
    ['get', `/reports/kid/${ALICE_KID}`],
    ['get', `/reports/daily-limit/${ALICE_KID}`],
    ['post', '/reports/screen-time/start'],
    ['post', '/reports/screen-time/end'],
  ])('%s %s rejects anonymous callers with 401', async (method, url) => {
    await (http() as never as Record<string, (u: string) => request.Test>)
      [method](url)
      .send({})
      .expect(401);
    expect(reports.getWeeklyOverview).not.toHaveBeenCalled();
    expect(reports.getKidDetailedReport).not.toHaveBeenCalled();
    expect(screenTime.getDailyLimitStatus).not.toHaveBeenCalled();
    expect(screenTime.startScreenTimeSession).not.toHaveBeenCalled();
    expect(screenTime.endScreenTimeSession).not.toHaveBeenCalled();
  });

  it('weekly overview: self and admin only', async () => {
    await http()
      .get(`/reports/weekly/${ALICE}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/reports/weekly/${ALICE}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/reports/weekly/${ALICE}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it.each([
    [`/reports/kid/${ALICE_KID}`],
    [`/reports/daily-limit/${ALICE_KID}`],
  ])("%s: the kid's parent and admin only", async (url) => {
    await http().get(url).set('Authorization', bearer('bob')).expect(403);
    expect(reports.getKidDetailedReport).not.toHaveBeenCalled();
    expect(screenTime.getDailyLimitStatus).not.toHaveBeenCalled();
    await http().get(url).set('Authorization', bearer('alice')).expect(200);
    await http().get(url).set('Authorization', bearer('admin')).expect(200);
  });

  it('starting a screen-time session with no kidId is rejected before any write', async () => {
    const controller = app.get(ReportsController);
    for (const userRole of ['user', 'admin']) {
      const req = { authUserData: { userId: ALICE, userRole } } as never;
      await expect(
        controller.startScreenTime({} as never, req),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(screenTime.startScreenTimeSession).not.toHaveBeenCalled();
  });

  it('ending or starting a screen-time session needs ownership of its kid', async () => {
    const controller = app.get(ReportsController);
    const bobReq = { authUserData: { userId: BOB, userRole: 'user' } } as never;
    await expect(
      controller.endScreenTime({ sessionId: SESSION }, bobReq),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.startScreenTime({ kidId: ALICE_KID }, bobReq),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(screenTime.endScreenTimeSession).not.toHaveBeenCalled();
    expect(screenTime.startScreenTimeSession).not.toHaveBeenCalled();

    const aliceReq = {
      authUserData: { userId: ALICE, userRole: 'user' },
    } as never;
    await controller.endScreenTime({ sessionId: SESSION }, aliceReq);
    expect(screenTime.endScreenTimeSession).toHaveBeenCalledWith(SESSION);
  });

  describe('screen-time request body validation', () => {
    it('POST /reports/screen-time/start accepts a valid body and rejects unknown properties', async () => {
      screenTime.startScreenTimeSession.mockResolvedValue({ sessionId: 's' });
      await http()
        .post('/reports/screen-time/start')
        .set('Authorization', bearer('alice'))
        .send({ kidId: ALICE_KID })
        .expect(201);
      expect(screenTime.startScreenTimeSession).toHaveBeenCalledWith(ALICE_KID);
      await http()
        .post('/reports/screen-time/start')
        .set('Authorization', bearer('alice'))
        .send({ kidId: ALICE_KID, extra: 1 })
        .expect(400);
      expect(screenTime.startScreenTimeSession).toHaveBeenCalledTimes(1);
    });

    it('POST /reports/screen-time/start rejects an empty kidId', async () => {
      await http()
        .post('/reports/screen-time/start')
        .set('Authorization', bearer('alice'))
        .send({ kidId: '' })
        .expect(400);
      expect(screenTime.startScreenTimeSession).not.toHaveBeenCalled();
    });

    it('POST /reports/screen-time/end accepts a valid body and rejects unknown properties', async () => {
      await http()
        .post('/reports/screen-time/end')
        .set('Authorization', bearer('alice'))
        .send({ sessionId: SESSION })
        .expect(201);
      expect(screenTime.endScreenTimeSession).toHaveBeenCalledWith(SESSION);
      await http()
        .post('/reports/screen-time/end')
        .set('Authorization', bearer('alice'))
        .send({ sessionId: SESSION, extra: 1 })
        .expect(400);
      expect(screenTime.endScreenTimeSession).toHaveBeenCalledTimes(1);
    });
  });
});
