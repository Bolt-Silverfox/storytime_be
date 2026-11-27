import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AvatarCoreController } from './avatar-core.controller';
import { AvatarService } from './avatar.service';
import { ADMIN, bearer, createAuthzApp } from '@/shared/testing/authz-harness';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('POST /avatars', () => {
  let app: INestApplication;
  const avatars = { createAvatar: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    avatars.createAvatar.mockResolvedValue({ id: 'a' });
    app = await createAuthzApp(
      [AvatarCoreController],
      [{ provide: AvatarService, useValue: avatars }],
    );
  });

  afterEach(() => app.close());

  const post = (who: 'alice' | 'admin') =>
    request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/avatars')
      .set('Authorization', bearer(who))
      .field('name', 'mine')
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });

  it('refuses a non-admin, who could never assign the avatar', async () => {
    await post('alice').expect(403);
    expect(avatars.createAvatar).not.toHaveBeenCalled();
  });

  it('creates a system avatar for an admin, exempt from the upload cap', async () => {
    await post('admin').expect(201);
    expect(avatars.createAvatar).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
      undefined,
      { userId: ADMIN, exempt: true },
    );
  });
});
