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
    updateIf: jest.fn(),
    listForReview: jest.fn(),
  };
  const upload = { uploadImageFromBuffer: jest.fn(), deleteImage: jest.fn() };
  let svc: SceneAdminService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo.updateIf.mockImplementation(
      (_id: string, _guard: object, data: object) =>
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
    const live = (over: Record<string, unknown>) => scene(over);
    const hash = (a: number, b: number) => hashSceneText(pages, a, b);

    beforeEach(() => {
      repo.findStoryText.mockResolvedValue({ id: 'st1', textContent: TEXT });
      repo.findByStory.mockResolvedValue([]);
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

    it('creates new scenes with hashes', async () => {
      await svc.replaceDefinitions('st1', [
        { startPage: 0, endPage: 1, prompt: 'p' },
        { startPage: 2, endPage: 3 },
      ]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.keeps).toEqual([]);
      expect(plan.retires).toEqual([]);
      expect(plan.creates).toEqual([
        expect.objectContaining({
          sceneIndex: 0,
          startPage: 0,
          endPage: 1,
          textHash: hash(0, 1),
          prompt: 'p',
        }),
        expect.objectContaining({ sceneIndex: 1, textHash: hash(2, 3) }),
      ]);
    });

    it('keeps an identical scene at the same index untouched', async () => {
      repo.findByStory.mockResolvedValue([
        live({ id: 'a', sceneIndex: 0, status: 'APPROVED', imageUrl: 'u' }),
      ]);
      await svc.replaceDefinitions('st1', [
        { startPage: 0, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.keeps).toEqual([
        expect.objectContaining({ id: 'a', fromIndex: 0, sceneIndex: 0 }),
      ]);
      expect(
        plan.creates.map((c: { sceneIndex: number }) => c.sceneIndex),
      ).toEqual([1]);
    });

    it('INSERT: an approved scene whose range is unchanged keeps its image when its index shifts', async () => {
      // old: [0-1 idx0, 2-3 idx1 APPROVED]  new: [0-0, 1-1, 2-3]
      repo.findByStory.mockResolvedValue([
        live({
          id: 'a',
          sceneIndex: 0,
          startPage: 0,
          endPage: 1,
          textHash: hash(0, 1),
        }),
        live({
          id: 'b',
          sceneIndex: 1,
          startPage: 2,
          endPage: 3,
          textHash: hash(2, 3),
          status: 'APPROVED',
          imageUrl: 'u',
        }),
      ]);
      await svc.replaceDefinitions('st1', [
        { startPage: 0, endPage: 0 },
        { startPage: 1, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.keeps).toEqual([
        expect.objectContaining({ id: 'b', fromIndex: 1, sceneIndex: 2 }),
      ]);
      expect(
        plan.creates.map((c: { sceneIndex: number }) => c.sceneIndex),
      ).toEqual([0, 1]);
      expect(plan.retires).toEqual([
        expect.objectContaining({ id: 'a', parkIndex: expect.any(Number) }),
      ]);
      expect(plan.retires[0].parkIndex).toBeLessThan(0);
    });

    it('SPLIT: the untouched half keeps its image, the split half is retired', async () => {
      // old: [0-3 idx0 APPROVED]  new: [0-1, 2-3]
      repo.findByStory.mockResolvedValue([
        live({
          id: 'a',
          sceneIndex: 0,
          startPage: 0,
          endPage: 3,
          textHash: hash(0, 3),
          status: 'APPROVED',
          imageUrl: 'u',
        }),
        live({ id: 'b', sceneIndex: 1, startPage: 4, endPage: 4 }),
      ]);
      await svc.replaceDefinitions('st1', [
        { startPage: 0, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.keeps).toEqual([]);
      expect(plan.creates).toHaveLength(2);
      expect(plan.retires.map((r: { id: string }) => r.id).sort()).toEqual([
        'a',
        'b',
      ]);
    });

    it('retires surplus scenes in place and never keeps a stale-hash scene', async () => {
      repo.findByStory.mockResolvedValue([
        live({ id: 'a', sceneIndex: 0, textHash: 'old' }),
        live({ id: 'c', sceneIndex: 5, startPage: 9, endPage: 9 }),
      ]);
      await svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 3 }]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.keeps).toEqual([]);
      const byId = Object.fromEntries(
        plan.retires.map((r: { id: string; parkIndex: number | null }) => [
          r.id,
          r.parkIndex,
        ]),
      );
      expect(byId.a).toEqual(expect.any(Number)); // occupies target index 0 -> parked
      expect(byId.c).toBeNull(); // index 5 is free -> soft-deleted in place
    });

    it('parks a soft-deleted row that occupies a needed index', async () => {
      repo.findByStory.mockResolvedValue([
        live({ id: 'd', sceneIndex: 0, isDeleted: true }),
      ]);
      await svc.replaceDefinitions('st1', [{ startPage: 0, endPage: 3 }]);
      const [, plan] = repo.applyPlan.mock.calls[0];
      expect(plan.retires).toEqual([
        expect.objectContaining({ id: 'd', parkIndex: expect.any(Number) }),
      ]);
    });
  });

  describe('uploadImage', () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    const uploaded = { secure_url: 'https://cdn/x.webp', public_id: 'pid' };

    it('uploads and conditionally moves the scene to PENDING_REVIEW', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'REJECTED', imageUrl: 'old' }),
      );
      upload.uploadImageFromBuffer.mockResolvedValue(uploaded);
      const res = await svc.uploadImage('s1', file, {
        provider: 'gemini',
        model: 'm',
      });
      expect(upload.uploadImageFromBuffer).toHaveBeenCalledWith(
        file.buffer,
        'scene-illustrations/st1',
      );
      const [id, guard, data] = repo.updateIf.mock.calls[0];
      expect(id).toBe('s1');
      expect(guard).toEqual(
        expect.objectContaining({
          startPage: 0,
          endPage: 1,
          textHash: hashSceneText(pages, 0, 1),
          isDeleted: false,
        }),
      );
      expect(data).toEqual(
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
      expect(res.previousImageUrl).toBe('old');
      expect(res.scene.status).toBe('PENDING_REVIEW');
    });

    it('409s and discards the upload when the scene changed while uploading', async () => {
      repo.findByIdWithStory.mockResolvedValue(scene());
      upload.uploadImageFromBuffer.mockResolvedValue(uploaded);
      repo.updateIf.mockResolvedValue(null);
      upload.deleteImage.mockResolvedValue(undefined);
      await expect(svc.uploadImage('s1', file, {})).rejects.toThrow(
        ConflictException,
      );
      expect(upload.deleteImage).toHaveBeenCalledWith('pid');
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
    const pending = (over: Record<string, unknown> = {}) =>
      scene({ status: 'PENDING_REVIEW', imageUrl: 'seen', ...over });

    it('requires an imageUrl', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending({ imageUrl: null }));
      await expect(svc.approve('s1', 'admin-1', 'seen')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.updateIf).not.toHaveBeenCalled();
    });

    it('only approves scenes pending review', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending({ status: 'REJECTED' }));
      await expect(svc.approve('s1', 'admin-1', 'seen')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses stale scenes', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending({ textHash: 'old' }));
      await expect(svc.approve('s1', 'admin-1', 'seen')).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s when the image changed since the reviewer saw it (nothing written)', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending({ imageUrl: 'Y' }));
      await expect(svc.approve('s1', 'admin-1', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect(repo.updateIf).not.toHaveBeenCalled();
    });

    it('writes conditionally on PENDING_REVIEW + the seen image and records the reviewer', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending());
      await svc.approve('s1', 'admin-1', 'seen');
      const [id, guard, data] = repo.updateIf.mock.calls[0];
      expect(id).toBe('s1');
      expect(guard).toEqual(
        expect.objectContaining({
          status: 'PENDING_REVIEW',
          imageUrl: 'seen',
          isDeleted: false,
        }),
      );
      expect(data).toEqual(
        expect.objectContaining({
          status: 'APPROVED',
          reviewedById: 'admin-1',
          reviewedAt: expect.any(Date),
          rejectionReason: null,
        }),
      );
    });

    it('409s when a concurrent reject/regenerate/upload wins (guarded write matches nothing)', async () => {
      repo.findByIdWithStory.mockResolvedValue(pending());
      repo.updateIf.mockResolvedValue(null);
      await expect(svc.approve('s1', 'admin-1', 'seen')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('stores reason and reviewer, guarded on status and the seen image', async () => {
      for (const status of ['PENDING_REVIEW', 'APPROVED']) {
        repo.findByIdWithStory.mockResolvedValue(
          scene({ status, imageUrl: 'seen' }),
        );
        await svc.reject('s1', 'admin-1', 'off-style', 'seen');
        const [, guard, data] = repo.updateIf.mock.calls.at(-1)!;
        expect(guard).toEqual(
          expect.objectContaining({ status, imageUrl: 'seen' }),
        );
        expect(data).toEqual(
          expect.objectContaining({
            status: 'REJECTED',
            reviewedById: 'admin-1',
            rejectionReason: 'off-style',
          }),
        );
      }
    });

    it('409s when the image changed since viewed', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_REVIEW', imageUrl: 'Y' }),
      );
      await expect(svc.reject('s1', 'a', 'r', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect(repo.updateIf).not.toHaveBeenCalled();
    });

    it('409s on a lost race', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_REVIEW', imageUrl: 'seen' }),
      );
      repo.updateIf.mockResolvedValue(null);
      await expect(svc.reject('s1', 'a', 'r', 'seen')).rejects.toThrow(
        ConflictException,
      );
    });

    it('cannot reject a scene with nothing to review', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_GENERATION' }),
      );
      await expect(svc.reject('s1', 'a', 'r', 'x')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('requestRegenerate', () => {
    it('clears image and review fields, guarded on the state it saw, and reports the old url', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'REJECTED', imageUrl: 'u' }),
      );
      const res = await svc.requestRegenerate('s1');
      const [, guard, data] = repo.updateIf.mock.calls[0];
      expect(guard).toEqual(
        expect.objectContaining({ status: 'REJECTED', imageUrl: 'u' }),
      );
      expect(data).toEqual(
        expect.objectContaining({
          status: 'PENDING_GENERATION',
          imageUrl: null,
          reviewedById: null,
          reviewedAt: null,
        }),
      );
      expect(res.previousImageUrl).toBe('u');
    });

    it('is a conflict when already pending generation or on a lost race', async () => {
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'PENDING_GENERATION' }),
      );
      await expect(svc.requestRegenerate('s1')).rejects.toThrow(
        ConflictException,
      );
      repo.findByIdWithStory.mockResolvedValue(
        scene({ status: 'APPROVED', imageUrl: 'u' }),
      );
      repo.updateIf.mockResolvedValue(null);
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
