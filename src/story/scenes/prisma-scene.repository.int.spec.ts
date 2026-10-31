import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaStorySceneRepository } from './prisma-scene.repository';
import { SceneReadService } from './scene-read.service';
import { SceneAdminService } from './scene-admin.service';
import { STORY_SCENE_REPOSITORY } from './scene.repository.interface';
import { UploadService } from '@/upload/upload.service';
import { hashSceneText, splitStoryIntoPages } from './story-pages.util';

const words = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
const TEXT = ['a', 'b', 'c', 'd'].map((p) => `${words(29, p)}.`).join(' ');
const pages = splitStoryIntoPages(TEXT);
const h = (a: number, b: number) => hashSceneText(pages, a, b);

/**
 * Real-Postgres tests for the approval invariant: only APPROVED, non-deleted,
 * image-bearing, non-stale scenes may ever be returned to a client, and the
 * review transitions are conditional so a reviewer can only approve the exact
 * image they saw.
 */
describe('Scene repository + services (integration)', () => {
  let prisma: PrismaService;
  let repo: PrismaStorySceneRepository;
  let storeRepo: PrismaStorySceneRepository; // the instance the services use
  let uploadSvc: { deleteImage: jest.Mock };
  let read: SceneReadService;
  let admin: SceneAdminService;
  let storyId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: STORY_SCENE_REPOSITORY,
          useClass: PrismaStorySceneRepository,
        },
        PrismaStorySceneRepository,
        SceneReadService,
        SceneAdminService,
        {
          provide: UploadService,
          useValue: {
            uploadImageFromBuffer: jest.fn().mockResolvedValue({
              secure_url: 'https://cdn/new.webp',
              public_id: 'p',
            }),
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaStorySceneRepository);
    storeRepo = module.get(STORY_SCENE_REPOSITORY);
    uploadSvc = module.get(UploadService);
    read = module.get(SceneReadService);
    admin = module.get(SceneAdminService);
  });

  beforeEach(async () => {
    const story = await prisma.story.create({
      data: {
        title: 'scene-int',
        description: 'd',
        language: 'english',
        coverImageUrl: 'c',
        audioUrl: '',
        isInteractive: false,
        ageMin: 3,
        ageMax: 8,
        textContent: TEXT,
      },
    });
    storyId = story.id;
  });

  afterEach(async () => {
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  afterAll(() => prisma.$disconnect());

  const mk = (
    sceneIndex: number,
    startPage: number,
    endPage: number,
    over: Record<string, unknown> = {},
  ) =>
    prisma.storySceneImage.create({
      data: {
        storyId,
        sceneIndex,
        startPage,
        endPage,
        textHash: h(startPage, endPage),
        imageUrl: `https://cdn/${sceneIndex}.webp`,
        status: 'APPROVED',
        ...over,
      } as never,
    });

  describe('only approved scenes are ever served', () => {
    it.each([
      ['PENDING_GENERATION', {}],
      ['PENDING_REVIEW', {}],
      ['REJECTED', {}],
    ])('never returns a %s scene', async (status) => {
      await mk(0, 0, 3, { status });
      expect(await repo.findApprovedByStory(storyId)).toEqual([]);
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
    });

    it('never returns soft-deleted, null-image or stale scenes', async () => {
      await mk(0, 0, 0, { isDeleted: true, deletedAt: new Date() });
      await mk(1, 1, 1, { imageUrl: null });
      await mk(2, 2, 2, { textHash: 'outdated' });
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
    });

    it('returns the approved, current scene', async () => {
      await mk(0, 0, 1);
      await mk(1, 2, 3, { status: 'REJECTED' });
      const res = await read.getReadExtras(storyId, TEXT);
      expect(res.scenes).toEqual([
        { index: 0, startPage: 0, endPage: 1, imageUrl: 'https://cdn/0.webp' },
      ]);
    });

    it('stops serving once the story text changes', async () => {
      await mk(0, 0, 3);
      const changed = TEXT.replace('a0', 'CHANGED');
      expect((await read.getReadExtras(storyId, changed)).scenes).toEqual([]);
    });
  });

  describe('guarded writes: a real write lands between the service load and its guarded update', () => {
    // The service has already loaded (and pre-checked) a snapshot when the
    // interleaved write happens, so only the guard in the guarded UPDATE can
    // stop it. Emptying/weakening a guard makes the matching test fail.
    const interleave = (fn: () => Promise<unknown>) => {
      const orig = storeRepo.findByIdWithStory.bind(storeRepo);
      jest
        .spyOn(storeRepo, 'findByIdWithStory')
        .mockImplementationOnce(async (id: string) => {
          const row = await orig(id);
          await fn();
          return row;
        });
    };
    const patch = (id: string, data: Record<string, unknown>) => () =>
      prisma.storySceneImage.update({ where: { id }, data: data as never });
    const reload = (id: string) =>
      prisma.storySceneImage.findUniqueOrThrow({ where: { id } });
    const file = { buffer: Buffer.from('y') } as Express.Multer.File;

    afterEach(() => jest.restoreAllMocks());

    it('approve: baseline succeeds when nothing interleaves', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      expect((await admin.approve(s.id, 'admin-1', 'X')).status).toBe(
        'APPROVED',
      );
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toHaveLength(1);
    });

    it('approve vs concurrent reject (status guard) -> 409, stays REJECTED, not served', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { status: 'REJECTED' }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('REJECTED');
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
    });

    it('approve vs concurrent upload of Y (imageUrl guard) -> 409, Y never approved', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { imageUrl: 'Y' }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      const row = await reload(s.id);
      expect([row.status, row.imageUrl]).toEqual(['PENDING_REVIEW', 'Y']);
    });

    it('approve vs concurrent regenerate -> 409, no APPROVED row without an image', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { status: 'PENDING_GENERATION', imageUrl: null }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      const row = await reload(s.id);
      expect([row.status, row.imageUrl]).toEqual(['PENDING_GENERATION', null]);
    });

    it('approve vs concurrent retire by a PUT (isDeleted guard) -> 409, stays unapproved', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { isDeleted: true, deletedAt: new Date() }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('PENDING_REVIEW');
    });

    it('approve vs concurrent redefinition of the scene text (range/hash guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { textHash: 'changed' }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('PENDING_REVIEW');
      const t = await mk(1, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      await prisma.storySceneImage.delete({ where: { id: s.id } });
      interleave(patch(t.id, { endPage: 2 }));
      await expect(admin.approve(t.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(t.id)).status).toBe('PENDING_REVIEW');
    });

    it('approve vs concurrent startPage change alone (startPage guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { startPage: 1 }));
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('PENDING_REVIEW');
    });

    it('reject vs concurrent upload of Y (imageUrl guard) -> 409, Y untouched', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { imageUrl: 'Y' }));
      await expect(admin.reject(s.id, 'a', 'r', 'X')).rejects.toThrow(
        ConflictException,
      );
      const row = await reload(s.id);
      expect([row.status, row.imageUrl]).toEqual(['PENDING_REVIEW', 'Y']);
    });

    it('reject vs concurrent status change (status guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { status: 'APPROVED' }));
      await expect(admin.reject(s.id, 'a', 'r', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('APPROVED');
    });

    it('reject vs concurrent retire (isDeleted guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      interleave(patch(s.id, { isDeleted: true, deletedAt: new Date() }));
      await expect(admin.reject(s.id, 'a', 'r', 'X')).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('PENDING_REVIEW');
    });

    it('regenerate vs concurrent upload of Y (imageUrl guard) -> 409, Y kept', async () => {
      const s = await mk(0, 0, 3, { status: 'APPROVED', imageUrl: 'X' });
      interleave(patch(s.id, { status: 'PENDING_REVIEW', imageUrl: 'Y' }));
      await expect(admin.requestRegenerate(s.id)).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).imageUrl).toBe('Y');
    });

    it('regenerate vs a different image landing with the same status (imageUrl guard alone) -> 409, Y kept', async () => {
      const s = await mk(0, 0, 3, { status: 'APPROVED', imageUrl: 'X' });
      interleave(patch(s.id, { imageUrl: 'Y' }));
      await expect(admin.requestRegenerate(s.id)).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).imageUrl).toBe('Y');
    });

    it('regenerate vs concurrent status change (status guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'APPROVED', imageUrl: 'X' });
      interleave(patch(s.id, { status: 'REJECTED' }));
      await expect(admin.requestRegenerate(s.id)).rejects.toThrow(
        ConflictException,
      );
      const row = await reload(s.id);
      expect([row.status, row.imageUrl]).toEqual(['REJECTED', 'X']);
    });

    it('regenerate vs concurrent retire (isDeleted guard) -> 409', async () => {
      const s = await mk(0, 0, 3, { status: 'APPROVED', imageUrl: 'X' });
      interleave(patch(s.id, { isDeleted: true, deletedAt: new Date() }));
      await expect(admin.requestRegenerate(s.id)).rejects.toThrow(
        ConflictException,
      );
      expect((await reload(s.id)).status).toBe('APPROVED');
    });

    it('upload vs concurrent redefinition (range/hash/isDeleted guards) -> 409, nothing attached, asset discarded', async () => {
      for (const change of [
        { textHash: 'changed' },
        { endPage: 2 },
        { startPage: 1 },
        { isDeleted: true, deletedAt: new Date() },
      ]) {
        jest.clearAllMocks();
        const s = await mk(0, 0, 3, {
          status: 'PENDING_GENERATION',
          imageUrl: null,
        });
        interleave(patch(s.id, change));
        await expect(admin.uploadImage(s.id, file, {})).rejects.toThrow(
          ConflictException,
        );
        const row = await reload(s.id);
        expect(row.imageUrl).toBeNull();
        expect(row.status).toBe('PENDING_GENERATION');
        expect(uploadSvc.deleteImage).toHaveBeenCalledWith('p');
        await prisma.storySceneImage.delete({ where: { id: s.id } });
      }
    });

    it('operating on a scene already retired by a redefinition is a 409, not a 404', async () => {
      const s = await mk(0, 0, 3, {
        status: 'PENDING_REVIEW',
        imageUrl: 'X',
        isDeleted: true,
        deletedAt: new Date(),
      });
      await expect(admin.approve(s.id, 'a', 'X')).rejects.toThrow(
        ConflictException,
      );
      await expect(admin.reject(s.id, 'a', 'r', 'X')).rejects.toThrow(
        ConflictException,
      );
      await expect(admin.requestRegenerate(s.id)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('replaceDefinitions keeps unchanged scenes across index shifts', () => {
    it('INSERT: [0-1, 2-3 approved] -> [0-0, 1-1, 2-3] keeps the approved art', async () => {
      await mk(0, 0, 1, { status: 'PENDING_GENERATION', imageUrl: null });
      const approved = await mk(1, 2, 3);
      await admin.replaceDefinitions(storyId, [
        { startPage: 0, endPage: 0 },
        { startPage: 1, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      const kept = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: approved.id },
      });
      expect(kept).toMatchObject({
        sceneIndex: 2,
        status: 'APPROVED',
        imageUrl: 'https://cdn/1.webp',
        isDeleted: false,
      });
      const res = await read.getReadExtras(storyId, TEXT);
      expect(res.scenes.map((x) => [x.index, x.imageUrl])).toEqual([
        [2, 'https://cdn/1.webp'],
      ]);
      const live = await repo.findByStory(storyId);
      expect(live.map((r) => r.sceneIndex)).toEqual([0, 1, 2]);
    });

    it('SPLIT: [0-3 approved] -> [0-1, 2-3] resets (range changed), nothing served', async () => {
      await mk(0, 0, 3);
      await admin.replaceDefinitions(storyId, [
        { startPage: 0, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
      const live = await repo.findByStory(storyId);
      expect(live.map((r) => [r.sceneIndex, r.status])).toEqual([
        [0, 'PENDING_GENERATION'],
        [1, 'PENDING_GENERATION'],
      ]);
    });

    it('repeated redefinition keeps working (parked rows do not collide)', async () => {
      await mk(0, 0, 3);
      for (const defs of [
        [
          { startPage: 0, endPage: 1 },
          { startPage: 2, endPage: 3 },
        ],
        [{ startPage: 0, endPage: 3 }],
        [
          { startPage: 0, endPage: 0 },
          { startPage: 1, endPage: 3 },
        ],
        [{ startPage: 0, endPage: 3 }],
      ]) {
        await admin.replaceDefinitions(storyId, defs);
        const live = await repo.findByStory(storyId);
        expect(live.map((r) => r.sceneIndex)).toEqual(defs.map((_, i) => i));
      }
    });

    it('a PUT that edits prompt/styleNotes on an UNMOVED kept row persists them and bumps updatedAt', async () => {
      const kept = await mk(0, 0, 3, {
        status: 'PENDING_REVIEW',
        imageUrl: 'X',
        prompt: 'old prompt',
        styleNotes: 'old style',
      });
      const before = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: kept.id },
      });
      await new Promise((r) => setTimeout(r, 15));
      await admin.replaceDefinitions(storyId, [
        {
          startPage: 0,
          endPage: 3,
          prompt: 'new prompt',
          styleNotes: 'new style',
        },
      ]);
      const after = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: kept.id },
      });
      expect(after).toMatchObject({
        sceneIndex: 0,
        prompt: 'new prompt',
        styleNotes: 'new style',
        status: 'PENDING_REVIEW',
        imageUrl: 'X',
      });
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
    });

    it('a PUT that edits only styleNotes persists it too', async () => {
      const kept = await mk(0, 0, 3, { prompt: 'p', styleNotes: 'a' });
      await admin.replaceDefinitions(storyId, [
        { startPage: 0, endPage: 3, prompt: 'p', styleNotes: 'b' },
      ]);
      const after = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: kept.id },
      });
      expect([after.prompt, after.styleNotes]).toEqual(['p', 'b']);
    });

    it('does not touch kept rows that do not move (review-queue position preserved)', async () => {
      const pending = await mk(0, 0, 1, {
        status: 'PENDING_REVIEW',
        imageUrl: 'X',
      });
      await mk(1, 2, 3, { status: 'PENDING_GENERATION', imageUrl: null });
      const before = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: pending.id },
      });
      await admin.replaceDefinitions(storyId, [
        { startPage: 0, endPage: 1 },
        { startPage: 2, endPage: 3 },
      ]);
      const after = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.status).toBe('PENDING_REVIEW');
    });

    it('a PUT that cannot get the story lock fails fast with 503, releasing its connection', async () => {
      await mk(0, 0, 3);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storyId}))`;
          locked();
          await held;
        },
        { timeout: 60_000 },
      );
      await lockTaken;
      const started = Date.now();
      try {
        await expect(
          admin.replaceDefinitions(storyId, [{ startPage: 0, endPage: 3 }]),
        ).rejects.toThrow(ServiceUnavailableException);
        expect(Date.now() - started).toBeLessThan(15_000);
      } finally {
        release();
        await holder;
      }
      // lock released: the same PUT now succeeds
      await admin.replaceDefinitions(storyId, [{ startPage: 0, endPage: 3 }]);
    }, 30_000);

    it('concurrent redefinitions serialise: all succeed (no deadlock / unique clash), contiguous result', async () => {
      await mk(0, 0, 3);
      const variants = [
        [{ startPage: 0, endPage: 3 }],
        [
          { startPage: 0, endPage: 1 },
          { startPage: 2, endPage: 3 },
        ],
        [
          { startPage: 0, endPage: 0 },
          { startPage: 1, endPage: 2 },
          { startPage: 3, endPage: 3 },
        ],
        [
          { startPage: 0, endPage: 2 },
          { startPage: 3, endPage: 3 },
        ],
      ];
      for (let round = 0; round < 8; round++) {
        const results = await Promise.allSettled(
          variants.map((v) => admin.replaceDefinitions(storyId, v)),
        );
        // serialised by the advisory lock: every redefinition succeeds
        // (without the lock these surface as unique-key clashes/deadlocks)
        expect(results.map((r) => r.status)).toEqual(
          variants.map(() => 'fulfilled'),
        );
        const live = await repo.findByStory(storyId);
        expect(live.map((x) => x.sceneIndex)).toEqual(live.map((_, i) => i));
        let next = 0;
        for (const sc of live) {
          expect(sc.startPage).toBe(next);
          next = sc.endPage + 1;
        }
        expect(next).toBe(pages.length);
      }
    });
  });
});
