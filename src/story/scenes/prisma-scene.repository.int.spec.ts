import { Test, TestingModule } from '@nestjs/testing';
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

  describe('approval races (guarded writes)', () => {
    it('approve of an image the reviewer saw succeeds', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      const res = await admin.approve(s.id, 'admin-1', 'X');
      expect(res.status).toBe('APPROVED');
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toHaveLength(1);
    });

    it('image replaced between view and approve -> 409, Y never served', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      await admin.uploadImage(s.id, { buffer: Buffer.from('y') } as never, {});
      await expect(admin.approve(s.id, 'admin-1', 'X')).rejects.toThrow(
        /changed|Conflict|pending/i,
      );
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
      const row = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(row.status).toBe('PENDING_REVIEW');
    });

    it('reject committed after approve loaded it -> stays REJECTED', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      // the approve's guarded write, issued after a concurrent reject
      await admin.reject(s.id, 'admin-2', 'nope', 'X');
      const won = await repo.updateIf(
        s.id,
        { status: 'PENDING_REVIEW', imageUrl: 'X', isDeleted: false },
        { status: 'APPROVED', reviewedById: 'admin-1', reviewedAt: new Date() },
      );
      expect(won).toBeNull();
      const row = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(row.status).toBe('REJECTED');
      expect((await read.getReadExtras(storyId, TEXT)).scenes).toEqual([]);
    });

    it('regenerate then approve -> 409, no APPROVED row without an image', async () => {
      const s = await mk(0, 0, 3, { status: 'PENDING_REVIEW', imageUrl: 'X' });
      await admin.requestRegenerate(s.id);
      await expect(admin.approve(s.id, 'admin-1', 'X')).rejects.toThrow();
      const row = await prisma.storySceneImage.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(row.status).toBe('PENDING_GENERATION');
      expect(row.imageUrl).toBeNull();
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
  });
});
