import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import {
  ALICE,
  ADMIN,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

describe('UploadController authorization', () => {
  let app: INestApplication;
  const uploads = {
    deleteOwned: jest.fn().mockResolvedValue(undefined),
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

  it('charges the upload to the caller, and exempts admins', async () => {
    await post().set('Authorization', bearer('alice')).expect(201);
    expect(uploads.uploadFile).toHaveBeenLastCalledWith(expect.anything(), {
      userId: ALICE,
      exempt: false,
    });
    await post().set('Authorization', bearer('admin')).expect(201);
    expect(uploads.uploadFile).toHaveBeenLastCalledWith(expect.anything(), {
      userId: ADMIN,
      exempt: true,
    });
  });

  it('rejects a file over 5 MB with 413 without touching storage', async () => {
    await request(app.getHttpServer())
      .post('/upload')
      .set('Authorization', bearer('alice'))
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.bin')
      .expect(413);
    expect(uploads.uploadFile).not.toHaveBeenCalled();
  });

  describe('DELETE /upload/:publicId', () => {
    const del = (id = 'storytime%2Fabc') =>
      request(app.getHttpServer() as Parameters<typeof request>[0]).delete(
        `/upload/${id}`,
      );

    it('rejects anonymous callers with 401', async () => {
      await del().expect(401);
      expect(uploads.deleteOwned).not.toHaveBeenCalled();
    });

    it('passes the decoded public id and the caller to the service', async () => {
      await del().set('Authorization', bearer('alice')).expect(200);
      expect(uploads.deleteOwned).toHaveBeenCalledWith(
        'storytime/abc',
        expect.objectContaining({ userId: ALICE }),
      );
    });

    it("answers 404 when the service says the upload is not the caller's", async () => {
      uploads.deleteOwned.mockRejectedValueOnce(new NotFoundException());
      await del().set('Authorization', bearer('alice')).expect(404);
    });
  });
});
