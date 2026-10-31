import { INestApplication, ValidationPipe } from '@nestjs/common';
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
// Nest's FileTypeValidator sniffs magic bytes through a dynamic ESM import of
// `file-type` (via `load-esm`), which Jest's CJS VM cannot do (it fails closed
// -> 400). Fake only that sniffer; the validator and the controller's regex run.
let sniffed: { mime: string; ext: string } | undefined = {
  mime: 'image/png',
  ext: 'png',
};
jest.mock('load-esm', () => ({
  loadEsm: () =>
    Promise.resolve({
      fileTypeFromBuffer: () => Promise.resolve(sniffed),
    }),
}));

const SCENE = { id: 's1', status: 'PENDING_REVIEW', imageUrl: 'u' };
const STORY_SCENES = { storyId: 'st1', pageCount: 4, scenes: [SCENE] };
// 1x1 PNG (real magic bytes: the upload pipe sniffs the file type)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('AdminSceneController authorization (real AdminGuard)', () => {
  let app: INestApplication;
  const svc = {
    listForStory: jest.fn().mockResolvedValue(STORY_SCENES),
    replaceDefinitions: jest.fn().mockResolvedValue(STORY_SCENES),
    uploadImage: jest
      .fn()
      .mockResolvedValue({ scene: SCENE, previousImageUrl: null }),
    approve: jest.fn().mockResolvedValue(SCENE),
    reject: jest.fn().mockResolvedValue({ ...SCENE, status: 'REJECTED' }),
    requestRegenerate: jest
      .fn()
      .mockResolvedValue({ scene: SCENE, previousImageUrl: 'u' }),
    reviewQueue: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    }),
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
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  type Route = [
    'get' | 'post' | 'put',
    string,
    number, // expected status for an admin
    (r: request.Test) => request.Test,
  ];
  const json = (body: object) => (r: request.Test) => r.send(body);
  const routes: Route[] = [
    ['get', '/admin/stories/st1/scenes', 200, (r) => r],
    [
      'put',
      '/admin/stories/st1/scenes',
      200,
      json({ scenes: [{ startPage: 0, endPage: 3 }] }),
    ],
    [
      'post',
      '/admin/scene-images/s1/image',
      201,
      (r) =>
        r.attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }),
    ],
    ['post', '/admin/scene-images/s1/approve', 200, json({ imageUrl: 'u' })],
    [
      'post',
      '/admin/scene-images/s1/reject',
      200,
      json({ reason: 'r', imageUrl: 'u' }),
    ],
    ['post', '/admin/scene-images/s1/regenerate', 200, (r) => r],
    ['get', '/admin/scene-images', 200, (r) => r],
  ];

  it.each(routes)(
    '%s %s -> 403 for a non-admin and for no user',
    async (m, url, _status, withBody) => {
      await withBody(request(app.getHttpServer())[m](url))
        .set('x-test-role', 'parent')
        .expect(403);
      await withBody(request(app.getHttpServer())[m](url)).expect(403);
      expect(svc.approve).not.toHaveBeenCalled();
      expect(svc.reject).not.toHaveBeenCalled();
      expect(svc.requestRegenerate).not.toHaveBeenCalled();
      expect(svc.uploadImage).not.toHaveBeenCalled();
      expect(svc.replaceDefinitions).not.toHaveBeenCalled();
    },
  );

  it.each(routes)('admin: %s %s -> %i', async (m, url, status, withBody) => {
    const res = await withBody(request(app.getHttpServer())[m](url)).set(
      'x-test-role',
      'admin',
    );
    if (res.status !== status) throw new Error(JSON.stringify(res.body));
    expect(res.status).toBe(status);
  });

  describe('POST scene-images/:id/image upload validation', () => {
    const post = () =>
      request(app.getHttpServer())
        .post('/admin/scene-images/s1/image')
        .set('x-test-role', 'admin');
    const png = { filename: 'a.png', contentType: 'image/png' };
    afterEach(() => {
      sniffed = { mime: 'image/png', ext: 'png' };
      svc.uploadImage.mockClear();
    });

    it.each(['image/webp', 'image/jpeg', 'image/gif'])(
      'accepts %s',
      async (mime) => {
        sniffed = { mime, ext: 'x' };
        await post().attach('file', PNG, png).expect(201);
      },
    );

    it.each(['application/pdf', 'image/svg+xml', 'text/html', 'image/bmp'])(
      'rejects sniffed type %s with 400 and never reaches the service',
      async (mime) => {
        sniffed = { mime, ext: 'x' };
        await post().attach('file', PNG, png).expect(400);
        expect(svc.uploadImage).not.toHaveBeenCalled();
      },
    );

    it('rejects a file whose type cannot be recognised (empty/garbage) with 400', async () => {
      sniffed = undefined;
      await post().attach('file', Buffer.alloc(0), png).expect(400);
      await post().attach('file', Buffer.from('not an image'), png).expect(400);
      expect(svc.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects a missing file with 400', async () => {
      await post().expect(400);
      expect(svc.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects an oversize file (> 5 MB) with 413', async () => {
      await post()
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), png)
        .expect(413);
      expect(svc.uploadImage).not.toHaveBeenCalled();
    });
  });
});
