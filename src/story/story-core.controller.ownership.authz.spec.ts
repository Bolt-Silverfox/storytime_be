import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { StoryCoreController } from './story-core.controller';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';
import { STORY_REPOSITORY } from './repositories/story.repository.interface';
import {
  ALICE,
  ALICE_KID,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const CATALOG_STORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ALICE_STORY = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const BOB_STORY = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';

const STORIES: Record<string, unknown> = {
  [CATALOG_STORY]: { id: CATALOG_STORY, creatorKidId: null, creatorKid: null },
  [ALICE_STORY]: {
    id: ALICE_STORY,
    creatorKidId: ALICE_KID,
    creatorKid: { parentId: ALICE },
  },
  [BOB_STORY]: {
    id: BOB_STORY,
    creatorKidId: BOB_KID,
    creatorKid: { parentId: BOB },
  },
};

describe('StoryCoreController story write ownership', () => {
  let app: INestApplication;
  const stories = {
    updateStory: jest.fn(),
    addImage: jest.fn(),
    addBranch: jest.fn(),
  };
  const repository = { findStoryByIdWithCreatorParent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of Object.values(stories)) fn.mockResolvedValue({ id: 's' });
    repository.findStoryByIdWithCreatorParent.mockImplementation((id: string) =>
      Promise.resolve(STORIES[id] ?? null),
    );
    app = await createAuthzApp(
      [StoryCoreController],
      [
        { provide: StoryService, useValue: stories },
        KidOwnershipService,
        { provide: STORY_REPOSITORY, useValue: repository },
        { provide: CACHE_MANAGER, useValue: {} },
      ],
    );
  });

  afterEach(() => app.close());

  const routes: [string, (id: string) => request.Test, jest.Mock][] = [
    [
      'PATCH /stories/:id',
      (id) => request(app.getHttpServer()).patch(`/stories/${id}`).send({}),
      stories.updateStory,
    ],
    [
      'POST /stories/:id/images',
      (id) =>
        request(app.getHttpServer())
          .post(`/stories/${id}/images`)
          .send({ url: 'https://example.com/a.png' }),
      stories.addImage,
    ],
    [
      'POST /stories/:id/branches',
      (id) =>
        request(app.getHttpServer())
          .post(`/stories/${id}/branches`)
          .send({ prompt: 'p', optionA: 'a', optionB: 'b' }),
      stories.addBranch,
    ],
  ];

  describe.each(routes)('%s', (_name, call, handler) => {
    it('lets an admin write a story with no creator kid', async () => {
      await call(CATALOG_STORY).set('Authorization', bearer('admin'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for an admin on a missing story', async () => {
      await call('missing').set('Authorization', bearer('admin')).expect(404);
      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a non-admin parent on a story with no creator kid', async () => {
      await call(CATALOG_STORY)
        .set('Authorization', bearer('alice'))
        .expect(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it("refuses a parent on another family's story", async () => {
      await call(BOB_STORY).set('Authorization', bearer('alice')).expect(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it("lets a parent write their own kid's story", async () => {
      await call(ALICE_STORY).set('Authorization', bearer('alice'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
