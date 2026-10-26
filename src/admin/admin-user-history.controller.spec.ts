import {
  ExecutionContext,
  INestApplication,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Server } from 'http';
import request from 'supertest';
import {
  AdminUserHistoryController,
  USER_VIEW_ACTIVITY_ACTION,
  USER_VIEW_READING_ACTION,
} from './admin-user-history.controller';
import { AdminUserHistoryService } from './admin-user-history.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminUserHistoryController', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Server;
  const getActivity = jest.fn();
  const getReading = jest.fn();
  const record = jest.fn();

  // Stand-in for AuthSessionGuard: the role comes from a test header so the
  // REAL AdminGuard decides.
  const fakeAuth = {
    canActivate: (ctx: ExecutionContext) => {
      const req = ctx.switchToHttp().getRequest();
      req.authUserData = {
        userId: 'admin-1',
        email: 'admin@example.com',
        userRole: req.headers['x-role'] ?? 'admin',
      };
      return true;
    },
  };

  const activityResult = {
    data: [{ id: 'a1', secretMarker: 'RETURNED-DATA' }],
    meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
  };
  const readingResult = {
    data: [{ storyId: 's1', title: 'RETURNED-DATA' }],
    summary: { storiesRead: 1 },
    meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUserHistoryController],
      providers: [
        {
          provide: AdminUserHistoryService,
          useValue: { getActivity, getReading },
        },
        { provide: AdminAuditLogService, useValue: { record } },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue(fakeAuth)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    getActivity.mockResolvedValue(activityResult);
    getReading.mockResolvedValue(readingResult);
    record.mockResolvedValue(undefined);
  });

  it('wires AuthSessionGuard and AdminGuard (@Admin())', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminUserHistoryController),
    ).toEqual([AuthSessionGuard, AdminGuard]);
  });

  describe.each([
    ['activity', getActivity],
    ['reading', getReading],
  ])('GET /admin/users/:userId/%s', (path, serviceFn) => {
    const url = `/admin/users/user-1/${path}`;

    it('403s a non-admin and does nothing else', async () => {
      await request(http()).get(url).set('x-role', 'parent').expect(403);
      expect(serviceFn).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('400s on an impossible calendar date', async () => {
      const q =
        path === 'activity' ? 'from=2026-02-30' : 'startDate=2026-02-30';
      await request(http()).get(`${url}?${q}`).expect(400);
      expect(serviceFn).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('400s on limit > 100 and on unknown query params', async () => {
      await request(http()).get(`${url}?limit=101`).expect(400);
      await request(http()).get(`${url}?bogus=1`).expect(400);
    });

    it('propagates 404 for an unknown user and writes no audit entry', async () => {
      serviceFn.mockRejectedValue(new NotFoundException('User not found'));
      await request(http()).get(url).expect(404);
      expect(record).not.toHaveBeenCalled();
    });
  });

  it('GET activity returns the envelope and records exactly one audit entry with {page, filters} only', async () => {
    const res = await request(http())
      .get(
        '/admin/users/user-1/activity?page=2&limit=5&action=USER_LOGIN&from=2026-01-01&to=2026-01-31&kidId=kid-9',
      )
      .expect(200);

    expect(res.body).toEqual({
      statusCode: 200,
      message: 'User activity retrieved successfully',
      data: activityResult.data,
      meta: activityResult.meta,
    });
    expect(getActivity).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ page: 2, limit: 5, action: 'USER_LOGIN' }),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: USER_VIEW_ACTIVITY_ACTION,
      targetType: 'User',
      targetId: 'user-1',
      details: {
        page: 2,
        filters: {
          action: 'USER_LOGIN',
          from: '2026-01-01',
          to: '2026-01-31',
          kidId: 'kid-9',
        },
      },
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('RETURNED-DATA');
  });

  it('GET reading returns summary + meta and records exactly one audit entry', async () => {
    const res = await request(http())
      .get('/admin/users/user-1/reading?range=30&kidId=kid-9')
      .expect(200);

    expect(res.body).toEqual({
      statusCode: 200,
      message: 'User reading history retrieved successfully',
      data: readingResult.data,
      summary: readingResult.summary,
      meta: readingResult.meta,
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      adminEmail: 'admin@example.com',
      action: USER_VIEW_READING_ACTION,
      targetType: 'User',
      targetId: 'user-1',
      details: { page: 1, filters: { range: 30, kidId: 'kid-9' } },
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('RETURNED-DATA');
  });

  it('defaults: audit filters omit unset values (reading default range=all is recorded)', async () => {
    await request(http()).get('/admin/users/user-1/activity').expect(200);
    expect(record.mock.calls[0][0].details).toEqual({ page: 1, filters: {} });
    await request(http()).get('/admin/users/user-1/reading').expect(200);
    expect(record.mock.calls[1][0].details).toEqual({
      page: 1,
      filters: { range: 'all' },
    });
  });

  describe('audit write failure never breaks the response', () => {
    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => errorSpy.mockRestore());

    it('rejected promise: still 200 and the failure is logged', async () => {
      record.mockRejectedValue(new Error('db down'));
      await request(http()).get('/admin/users/user-1/activity').expect(200);
      await request(http()).get('/admin/users/user-1/reading').expect(200);
      await new Promise((r) => setImmediate(r));
      expect(record).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it('synchronous throw: still 200', async () => {
      record.mockImplementation(() => {
        throw new Error('boom');
      });
      await request(http()).get('/admin/users/user-1/reading').expect(200);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
