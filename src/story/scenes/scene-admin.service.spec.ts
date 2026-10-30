import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SceneAdminService } from './scene-admin.service';
import { hashSceneText, splitStoryIntoPages } from './story-pages.util';

const words = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
const TEXT = ['a', 'b', 'c', 'd'].map((p) => `${words(29, p)}.`).join(' ');
const pages = splitStoryIntoPages(TEXT);

const scene = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  storyId: 'st1',
  sceneIndex: 0,
  startPage: 0,
  endPage: 1,
  textHash: hashSceneText(pages, 0, 1),
  imageUrl: null as string | null,
  prompt: null,
  styleNotes: null,
  provider: null,
  model: null,
  status: 'PENDING_GENERATION',
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  story: { id: 'st1', title: 'T', textContent: TEXT },
  ...over,
});

describe('SceneAdminService', () => {
  const repo = {
    findStoryText: jest.fn(),
    findByStory: jest.fn(),
    findByIdWithStory: jest.fn(),
    applyPlan: jest.fn(),
    update: jest.fn(),
    listForReview: jest.fn(),
  };
  const upload = { uploadImageFromBuffer: jest.fn() };
  let svc: SceneAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.update.mockImplementation((_id: string, data: object) =>
      Promise.resolve({ ...scene(), ...data }),
    );
    svc = new SceneAdminService(repo as never, upload as never);
  });

  describe('listForStory', () => {
    it('404s for an unknown story', async () => {
      repo.findStoryText.mockResolvedValue(null);
      await expect(svc.listForStory('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns pageCount and flags stale scenes', async () => {
      repo.findStoryText.mockResolvedValue({ id: 'st1', textContent: TEXT });
      repo.findByStory.mockResolvedValue([
        scene(),
        scene({ id: 's2', sceneIndex: 1, startPage: 2, endPage: 3 }),
      ]);
      const res = await svc.listForStory('st1');
      expect(res.pageCount).toBe(4);
      expect(res.scenes.map((s) => s.isStale)).toEqual([false, true]);
    });
  });

  describe('replaceDefinitions', () => {
    beforeEach(() => {
      repo.findStoryText.mockResolvedValue({ id: 'st1', textContent: TEXT });
    });

    it('rejects invalid ranges without writing', async () => {
      await expect(
        svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 2 }]),
      ).rejects.toThrow(BadRequestException);
      expect(repo.applyPlan).not.toHaveBeenCalled();
    });

    it('rejects a story with no text', async () => {
      repo.findStoryText.mockResolvedValue({ id: 'st1', textContent: null });
      await expect(
        svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 0 }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates new scenes with hashes and removes surplus old ones', async () => {
      repo.findByStory.mockResolvedValueOnce([
        scene({ sceneIndex: 0 }),
        scene({ id: 's3', sceneIndex: 2, startPage: 3, endPage: 3 }),
      ]);
      repo.findByStory.mockResolvedValueOnce([]);
      await svc.replaceDefinitions('st1', [
        { startPage: 0, endPage: 1, prompt: 'p' },
        { startPage: 2, endPage: 3 },
      ]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.upserts).toEqual([
        expect.objectContaining({
          sceneIndex: 0,
          startPage: 0,
          endPage: 1,
          textHash: hashSceneText(pages, 0, 1),
          reset: false,
          prompt: 'p',
        }),
        expect.objectContaining({
          sceneIndex: 1,
          textHash: hashSceneText(pages, 2, 3),
          reset: true,
        }),
      ]);
      expect(plan.removeIndexes).toEqual([2]);
    });

    it('resets a scene whose range changed but keeps an identical one', async () => {
      repo.findByStory.mockResolvedValueOnce([
        scene({ sceneIndex: 0, status: 'APPROVED', imageUrl: 'u' }),
      ]);
      repo.findByStory.mockResolvedValueOnce([]);
      await svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 3 }]);
      expect(repo.applyPlan.mock.calls[0][1].upserts[0].reset).toBe(true);
    });

    it('resets an identical-range scene whose stored hash is stale', async () => {
      repo.findByStory.mockResolvedValueOnce([
        scene({ sceneIndex: 0, textHash: 'old' }),
      ]);
      repo.findByStory.mockResolvedValueOnce([]);
      await svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 3 }]);
      expect(repo.applyPlan.mock.calls[0][1].upserts[0].reset).toBe(true);
    });
  });

  describe('uploadImage', () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;

    it('uploads to Cloudinary and moves the scene to PENDING_REVIEW', async () => {
      repo.findByIdWithStory.mockResolvedValue(scene({ status: 'REJECTED' }));
      upload.uploadImageFromBuffer.mockResolvedValue({
        secure_url: 'https://cdn/x.webp',
      });
      await svc.uploadImage('s1', file, { provider: 'gemini', model: 'm' });
      expect(upload.uploadImageFromBuffer).toHaveBeenCalledWith(
        file.buffer,
        'scene-illustrations/st1',
      );
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          imageUrl: 'https://cdn/x.webp',
          status: 'PENDING_REVIEW',
          provider: 'gemini',
          model: 'm',
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
        }),
      );
    });

    it('refuses to upload for a stale scene', async () => {
      repo.findByIdWithStory.mockResolvedValue(scene({ textHash: 'old' }));
      await expect(svc.uploadImage('s1', file, {})).rejects.toThrow(
        ConflictException,
      );
      expect(upload.uploadImageFromBuffer).not.toHaveBeenCalled();
    });

    it('404s for an unknown scene', async () => {
      repo.findByIdWithStory.mockResolvedValue(null);
      await expect(svc.uploadImage('x', file, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('requires an imageUrl', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_REVIEW', imageUrl: null }),
      );
      await expect(svc.approve('s1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('only approves scenes pending review', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'REJECTED', imageUrl: 'u' }),
      );
      await expect(svc.approve('s1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses stale scenes', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_REVIEW', imageUrl: 'u', textHash: 'old' }),
      );
      await expect(svc.approve('s1', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('records the reviewer', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_REVIEW', imageUrl: 'u' }),
      );
      await svc.approve('s1', 'admin-1');
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          status: 'APPROVED',
          reviewedById: 'admin-1',
          reviewedAt: expect.any(Date),
          rejectionReason: null,
        }),
      );
    });
  });

  describe('reject', () => {
    it('stores the reason and reviewer; allowed from PENDING_REVIEW and APPROVED', async () => {
      for (const status of ['PENDING_REVIEW', 'APPROVED']) {
        repo.findByIdWithStory.mockResolvedValue(
          scene({ status, imageUrl: 'u' }),
        );
        await svc.reject('s1', 'admin-1', 'off-style');
        expect(repo.update).toHaveBeenLastCalledWith(
          's1',
          expect.objectContaining({
            status: 'REJECTED',
            reviewedById: 'admin-1',
            rejectionReason: 'off-style',
          }),
        );
      }
    });

    it('cannot reject a scene with nothing to review', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_GENERATION' }),
      );
      await expect(svc.reject('s1', 'a', 'r')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('requestRegenerate', () => {
    it('clears the image and review fields and queues generation', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'REJECTED', imageUrl: 'u' }),
      );
      await svc.requestRegenerate('s1');
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          status: 'PENDING_GENERATION',
          imageUrl: null,
          reviewedById: null,
          reviewedAt: null,
        }),
      );
    });

    it('is a conflict when already pending generation', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_GENERATION' }),
      );
      await expect(svc.requestRegenerate('s1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reviewQueue', () => {
    it('defaults to PENDING_REVIEW, paginates and reports meta', async () => {
      repo.listForReview.mockResolvedValue({
        items: [scene({ status: 'PENDING_REVIEW' })],
        total: 25,
      });
      const res = await svc.reviewQueue({ page: 2, limit: 10 });
      expect(repo.listForReview).toHaveBeenCalledWith({
        status: 'PENDING_REVIEW',
        skip: 10,
        take: 10,
      });
      expect(res.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
      expect(res.data[0]).toEqual(
        expect.objectContaining({ storyTitle: 'T', isStale: false }),
      );
      expect(res.data[0]).not.toHaveProperty('story');
    });
  });
});
