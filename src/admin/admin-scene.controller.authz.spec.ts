import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminSceneController } from './admin-scene.controller';
import { SceneAdminService } from '@/story/scenes/scene-admin.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';

/**
 * Exercises the REAL AdminGuard: only AuthSessionGuard (JWT/session lookup) is
 * replaced by a stub that trusts an `x-test-role` header.
 */
describe('AdminSceneController authorization (real AdminGuard)', () => {
  let app: INestApplication;
  const svc = {
    listForStory: jest.fn().mockResolvedValue({ scenes: [] }),
    replaceDefinitions: jest.fn(),
    uploadImage: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    requestRegenerate: jest.fn(),
    reviewQueue: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AdminSceneController],
      providers: [
        { provide: SceneAdminService, useValue: svc },
        { provide: AdminAuditLogService, useValue: { record: jest.fn() } },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string>;
              authUserData?: object;
            };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (role) req.authUserData = { userId: 'u1', userRole: role };
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  const routes: Array<['get' | 'post' | 'put', string]> = [
    ['get', '/admin/stories/st1/scenes'],
    ['put', '/admin/stories/st1/scenes'],
    ['post', '/admin/scene-images/s1/image'],
    ['post', '/admin/scene-images/s1/approve'],
    ['post', '/admin/scene-images/s1/reject'],
    ['post', '/admin/scene-images/s1/regenerate'],
    ['get', '/admin/scene-images'],
  ];

  it.each(routes)(
    '%s %s -> 403 for a non-admin and for no user',
    async (m, url) => {
      await request(app.getHttpServer())
        [m](url)
        .set('x-test-role', 'parent')
        .expect(403);
      await request(app.getHttpServer())[m](url).expect(403);
      expect(svc.approve).not.toHaveBeenCalled();
      expect(svc.reject).not.toHaveBeenCalled();
      expect(svc.requestRegenerate).not.toHaveBeenCalled();
      expect(svc.uploadImage).not.toHaveBeenCalled();
      expect(svc.replaceDefinitions).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    '%s %s is not blocked by the guard for an admin (anything but 401/403)',
    async (m, url) => {
      const res = await request(app.getHttpServer())
        [m](url)
        .set('x-test-role', 'admin');
      expect([401, 403]).not.toContain(res.status);
    },
  );
});
