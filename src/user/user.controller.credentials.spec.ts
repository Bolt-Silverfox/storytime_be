import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UploadService } from '@/upload/upload.service';
import { UserDataExportService } from './services/user-data-export.service';
import {
  ALICE,
  BOB,
  HASH_SENTINELS,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

const rowWithSecrets = (id: string) => ({
  id,
  email: `${id}@example.com`,
  name: 'Name',
  role: 'user',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  profile: { language: 'en', country: 'NG' },
  avatar: { id: 'a1', url: 'https://x/y.png' },
  kids: [{ id: 'k1', parent: { id, ...HASH_SENTINELS } }],
  message: 'm',
  permanent: false,
  ...HASH_SENTINELS,
});

const expectNoCredentials = (body: unknown) => {
  const text = JSON.stringify(body);
  expect(text).not.toContain(HASH_SENTINELS.passwordHash);
  expect(text).not.toContain(HASH_SENTINELS.pinHash);
  expect(text).not.toMatch(/passwordHash|pinHash/);
};

describe('UserController responses never carry credential hashes', () => {
  let app: INestApplication;
  const userService = {
    updateParentProfile: jest.fn(),
    updateAvatarForParent: jest.fn(),
    createAndAssignAvatar: jest.fn(),
    undoDeleteMyAccount: jest.fn(),
    undoDeleteUser: jest.fn(),
    deleteUserAccount: jest.fn(),
  };
  const upload = {
    uploadImage: jest
      .fn()
      .mockResolvedValue({ secure_url: 'https://x/y.png', public_id: 'p' }),
    deleteImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of Object.values(userService)) {
      fn.mockImplementation((id: string) =>
        Promise.resolve(rowWithSecrets(id)),
      );
    }
    app = await createAuthzApp(
      [UserController],
      [
        { provide: UserService, useValue: userService },
        { provide: UploadService, useValue: upload },
        { provide: UserDataExportService, useValue: {} },
      ],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  it('PATCH /user/me', async () => {
    const res = await http()
      .patch('/user/me')
      .set('Authorization', bearer('alice'))
      .send({ name: 'New' })
      .expect(200);
    expect(res.body.id).toBe(ALICE);
    expectNoCredentials(res.body);
  });

  it('POST /user/me/avatar', async () => {
    const res = await http()
      .post('/user/me/avatar')
      .set('Authorization', bearer('alice'))
      .send({ avatarId: 'a1' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.id).toBe(ALICE);
    expectNoCredentials(res.body);
  });

  it('POST /user/me/upload-avatar', async () => {
    const res = await http()
      .post('/user/me/upload-avatar')
      .set('Authorization', bearer('alice'))
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.id).toBe(ALICE);
    expectNoCredentials(res.body);
  });

  it('POST /user/me/undo-delete', async () => {
    const res = await http()
      .post('/user/me/undo-delete')
      .set('Authorization', bearer('alice'));
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.id).toBe(ALICE);
    expectNoCredentials(res.body);
  });

  it("POST /user/:id/undo-delete (admin restoring another user's account)", async () => {
    const res = await http()
      .post(`/user/${BOB}/undo-delete`)
      .set('Authorization', bearer('admin'));
    expect(res.status).toBeLessThan(300);
    expect(res.body.data.id).toBe(BOB);
    expectNoCredentials(res.body);
  });

  it('DELETE /user/me (soft delete) returns only id, email, message, permanent', async () => {
    const res = await http()
      .delete('/user/me')
      .set('Authorization', bearer('alice'))
      .expect(200);
    expectNoCredentials(res.body);
    expect(res.body.data).toEqual({
      id: ALICE,
      email: `${ALICE}@example.com`,
      message: 'm',
      permanent: false,
    });
  });
});
