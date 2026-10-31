import { SceneReadService } from './scene-read.service';
import { hashSceneText, splitStoryIntoPages } from './story-pages.util';

const words = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
// 4 pages of 30 words each (one sentence per page)
const TEXT = ['a', 'b', 'c', 'd'].map((p) => `${words(29, p)}.`).join(' ');
const pages = splitStoryIntoPages(TEXT);

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  storyId: 'st1',
  sceneIndex: 0,
  startPage: 0,
  endPage: 1,
  textHash: hashSceneText(pages, 0, 1),
  imageUrl: 'https://img/0.webp',
  status: 'APPROVED',
  ...over,
});

describe('SceneReadService', () => {
  const repo = { findApprovedByStory: jest.fn() };
  let svc: SceneReadService;
  beforeEach(() => {
    jest.resetAllMocks();
    svc = new SceneReadService(repo as never);
  });

  it('exposes the backend page split as `pages`', async () => {
    repo.findApprovedByStory.mockResolvedValue([]);
    const res = await svc.getReadExtras('st1', TEXT);
    expect(res.pages).toEqual(pages);
    expect(res.pages).toHaveLength(4);
    expect(res.pageCount).toBe(4);
    expect(res.scenes).toEqual([]);
  });

  it('returns only the public scene fields', async () => {
    repo.findApprovedByStory.mockResolvedValue([row()]);
    const res = await svc.getReadExtras('st1', TEXT);
    expect(res.scenes).toEqual([
      { index: 0, startPage: 0, endPage: 1, imageUrl: 'https://img/0.webp' },
    ]);
  });

  it('queries approved scenes only and drops rows without an imageUrl', async () => {
    repo.findApprovedByStory.mockResolvedValue([row({ imageUrl: null })]);
    const res = await svc.getReadExtras('st1', TEXT);
    expect(repo.findApprovedByStory).toHaveBeenCalledWith('st1');
    expect(res.scenes).toEqual([]);
  });

  it('excludes stale scenes (text hash mismatch)', async () => {
    repo.findApprovedByStory.mockResolvedValue([
      row(),
      row({
        id: 's2',
        sceneIndex: 1,
        startPage: 2,
        endPage: 3,
        textHash: 'outdated',
      }),
    ]);
    const res = await svc.getReadExtras('st1', TEXT);
    expect(res.scenes.map((s) => s.index)).toEqual([0]);
  });

  it('excludes scenes beyond the current page count and sorts by index', async () => {
    repo.findApprovedByStory.mockResolvedValue([
      row({ id: 'x', sceneIndex: 5, startPage: 8, endPage: 9 }),
      row({
        id: 's2',
        sceneIndex: 1,
        startPage: 2,
        endPage: 3,
        textHash: hashSceneText(pages, 2, 3),
        imageUrl: 'https://img/1.webp',
      }),
      row(),
    ]);
    const res = await svc.getReadExtras('st1', TEXT);
    expect(res.scenes.map((s) => s.index)).toEqual([0, 1]);
  });

  it('skips the DB when the story has no text', async () => {
    const res = await svc.getReadExtras('st1', null);
    expect(res).toEqual({ pages: [], pageCount: 0, scenes: [] });
    expect(repo.findApprovedByStory).not.toHaveBeenCalled();
  });
});
