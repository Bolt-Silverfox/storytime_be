import { Test } from '@nestjs/testing';
import { AdminSceneController } from './admin-scene.controller';
import { SceneAdminService } from '@/story/scenes/scene-admin.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminSceneController', () => {
  const svc = {
    listForStory: jest.fn(),
    replaceDefinitions: jest.fn(),
    uploadImage: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    requestRegenerate: jest.fn(),
    reviewQueue: jest.fn(),
  };
  const record = jest.fn();
  const req = {
    authUserData: { userId: 'admin-1', email: 'admin@example.com' },
  } as unknown as AuthenticatedRequest;
  let controller: AdminSceneController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [AdminSceneController],
      providers: [
        { provide: SceneAdminService, useValue: svc },
        { provide: AdminAuditLogService, useValue: { record } },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(AdminSceneController);
  });

  it('is admin-guarded', () => {
    expect(
      (Reflect.getMetadata('__guards__', AdminSceneController) ?? []).length,
    ).toBeGreaterThan(0);
  });

  it("lists a story's scenes", async () => {
    svc.listForStory.mockResolvedValue({ pageCount: 4, scenes: [] });
    const res = await controller.listForStory('st1');
    expect(svc.listForStory).toHaveBeenCalledWith('st1');
    expect(res.data).toEqual({ pageCount: 4, scenes: [] });
  });

  it('replaces definitions and audit-logs', async () => {
    svc.replaceDefinitions.mockResolvedValue({ pageCount: 4, scenes: [] });
    await controller.replace(req, 'st1', {
      scenes: [{ startPage: 0, endPage: 3 }],
    });
    expect(svc.replaceDefinitions).toHaveBeenCalledWith('st1', [
      { startPage: 0, endPage: 3 },
    ]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'scene_image.define',
        targetType: 'Story',
        targetId: 'st1',
      }),
    );
  });

  it('uploads an image', async () => {
    svc.uploadImage.mockResolvedValue({ id: 's1', status: 'PENDING_REVIEW' });
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    await controller.uploadImage(req, 's1', file, { provider: 'p' });
    expect(svc.uploadImage).toHaveBeenCalledWith('s1', file, { provider: 'p' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scene_image.upload', targetId: 's1' }),
    );
  });

  it('approve passes the reviewer id and audit-logs', async () => {
    svc.approve.mockResolvedValue({ id: 's1', status: 'APPROVED' });
    await controller.approve(req, 's1');
    expect(svc.approve).toHaveBeenCalledWith('s1', 'admin-1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        action: 'scene_image.approve',
        targetType: 'StorySceneImage',
        targetId: 's1',
      }),
    );
  });

  it('reject passes reviewer + reason', async () => {
    svc.reject.mockResolvedValue({ id: 's1', status: 'REJECTED' });
    await controller.reject(req, 's1', { reason: 'bad hands' });
    expect(svc.reject).toHaveBeenCalledWith('s1', 'admin-1', 'bad hands');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'scene_image.reject',
        details: expect.objectContaining({ reason: 'bad hands' }),
      }),
    );
  });

  it('regenerate queues generation', async () => {
    svc.requestRegenerate.mockResolvedValue({ id: 's1' });
    await controller.regenerate(req, 's1');
    expect(svc.requestRegenerate).toHaveBeenCalledWith('s1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scene_image.regenerate' }),
    );
  });

  it('review queue forwards filters and returns meta', async () => {
    svc.reviewQueue.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });
    const res = await controller.reviewQueue({
      status: 'REJECTED',
      page: 1,
      limit: 10,
    } as never);
    expect(svc.reviewQueue).toHaveBeenCalledWith({
      status: 'REJECTED',
      page: 1,
      limit: 10,
    });
    expect(res.meta.total).toBe(0);
  });
});
