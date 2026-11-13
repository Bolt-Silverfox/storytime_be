import {
  Controller,
  Get,
  INestApplication,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import request from 'supertest';
import { RewardController } from '@/reward/reward.controller';
import { RewardService } from '@/reward/reward.service';
import { NotificationController } from '@/notification/notification.controller';
import { NotificationService } from '@/notification/notification.service';
import { AnalyticsController } from '@/analytics/analytics.controller';
import { AnalyticsService } from '@/analytics/analytics.service';
import {
  ADMIN,
  ALICE,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
  dbControl,
  dbUsers,
} from '@/shared/testing/authz-harness';

@Controller('whoami')
@UseGuards(AuthSessionGuard)
class WhoAmIController {
  @Get()
  whoami(@Req() req: AuthenticatedRequest) {
    return { role: req.authUserData.userRole };
  }
}

describe('admin access is confirmed against the database, not the JWT claim', () => {
  let app: INestApplication;
  const rewards = { findByKid: jest.fn().mockResolvedValue([]) };
  const notifications = { getForUser: jest.fn().mockResolvedValue([]) };
  const analytics = { getStats: jest.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await createAuthzApp(
      [
        RewardController,
        NotificationController,
        AnalyticsController,
        WhoAmIController,
      ],
      [
        { provide: RewardService, useValue: rewards },
        { provide: NotificationService, useValue: notifications },
        { provide: AnalyticsService, useValue: analytics },
      ],
    );
  });

  afterEach(() => app.close());

  const admin = () => bearer('admin');
  const stats = () =>
    request(app.getHttpServer())
      .get('/analytics/stats')
      .set('Authorization', admin());
  const kidRewards = () =>
    request(app.getHttpServer())
      .get(`/rewards/kid/${BOB_KID}`)
      .set('Authorization', admin());
  const userPrefs = () =>
    request(app.getHttpServer())
      .get(`/notification-preferences/users/${BOB}`)
      .set('Authorization', admin());

  it('still lets a database admin through every admin path', async () => {
    await stats().expect(200);
    await kidRewards().expect(200);
    await userPrefs().expect(200);
  });

  it.each([
    ['demoted to parent', { role: 'parent' }],
    ['suspended', { isSuspended: true }],
    ['soft-deleted', { isDeleted: true }],
  ])('refuses an admin token whose user is %s', async (_label, patch) => {
    dbUsers[ADMIN] = { ...dbUsers[ADMIN], ...patch };
    await stats().expect(403);
    await kidRewards().expect(403);
    await userPrefs().expect(403);
    expect(analytics.getStats).not.toHaveBeenCalled();
    expect(rewards.findByKid).not.toHaveBeenCalled();
    expect(notifications.getForUser).not.toHaveBeenCalled();
  });

  it('refuses an admin token whose user row is gone', async () => {
    delete dbUsers[ADMIN];
    await stats().expect(403);
  });

  it('never promotes a non-admin claim, whatever the database says', async () => {
    dbUsers[ALICE] = { ...dbUsers[ALICE], role: 'admin' };
    await request(app.getHttpServer())
      .get('/analytics/stats')
      .set('Authorization', bearer('alice'))
      .expect(403);
  });

  it('fails closed when the role lookup rejects, and warns with the user id only', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    dbControl.failLookups = true;
    await stats().expect(403);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(ADMIN);
    expect(logged).not.toContain('@example.com');
    warn.mockRestore();
  });
});
