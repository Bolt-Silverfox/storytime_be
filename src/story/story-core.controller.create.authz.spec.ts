import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { StoryCoreController } from './story-core.controller';
import { StoryService } from './story.service';
import { KidOwnershipService } from './services/kid-ownership.service';
import { bearer, createAuthzApp } from '@/shared/testing/authz-harness';

const body = {
  title: 'A title',
  description: 'A description',
  language: 'en',
  themeIds: [],
  categoryIds: [],
};

describe('POST /stories (catalog story creation) authorization', () => {
  let app: INestApplication;
  const stories = { createStory: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    stories.createStory.mockResolvedValue({ id: 's1' });
    app = await createAuthzApp(
      [StoryCoreController],
      [
        { provide: StoryService, useValue: stories },
        { provide: KidOwnershipService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
      ],
    );
  });

  afterEach(() => app.close());

  const post = () => request(app.getHttpServer()).post('/stories').send(body);

  it('rejects anonymous callers with 401', async () => {
    await post().expect(401);
    expect(stories.createStory).not.toHaveBeenCalled();
  });

  it('rejects a non-admin user with 403 and never publishes or notifies', async () => {
    await post().set('Authorization', bearer('alice')).expect(403);
    expect(stories.createStory).not.toHaveBeenCalled();
  });

  it('lets an admin create a story', async () => {
    await post().set('Authorization', bearer('admin')).expect(201);
    expect(stories.createStory).toHaveBeenCalledTimes(1);
  });
});
