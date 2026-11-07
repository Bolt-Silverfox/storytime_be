import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { bearer, createAuthzApp } from '@/shared/testing/authz-harness';

describe('UploadController authorization', () => {
  let app: INestApplication;
  const uploads = {
    uploadFile: jest
      .fn()
      .mockResolvedValue({ secure_url: 'https://x/y', public_id: 'p' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await createAuthzApp(
      [UploadController],
      [{ provide: UploadService, useValue: uploads }],
    );
  });

  afterEach(() => app.close());

  const post = () =>
    request(app.getHttpServer())
      .post('/upload')
      .attach('file', Buffer.from('data'), 'a.txt');

  it('rejects anonymous callers with 401 without touching storage', async () => {
    await post().expect(401);
    expect(uploads.uploadFile).not.toHaveBeenCalled();
  });

  it('accepts an authenticated user', async () => {
    await post().set('Authorization', bearer('alice')).expect(201);
    expect(uploads.uploadFile).toHaveBeenCalledTimes(1);
  });
});
