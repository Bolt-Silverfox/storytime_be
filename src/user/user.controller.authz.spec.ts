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

const userRow = (id: string) => ({
  id,
  email: `${id}@example.com`,
  name: 'Name',
  role: 'user',
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: null,
  avatar: null,
  kids: [],
  ...HASH_SENTINELS,
});

describe('UserController /user/:id authorization', () => {
  let app: INestApplication;
  const userService = {
    getUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUserAccount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    userService.getUser.mockImplementation((id: string) =>
      Promise.resolve(userRow(id)),
    );
    userService.updateUser.mockImplementation((id: string) =>
      Promise.resolve(userRow(id)),
    );
    userService.deleteUserAccount.mockImplementation(
      (id: string, permanent: boolean) =>
        Promise.resolve(
          permanent
            ? { id, email: 'e', message: 'm', permanent: true }
            : { ...userRow(id), message: 'm', permanent: false },
        ),
    );
    app = await createAuthzApp(
      [UserController],
      [
        { provide: UserService, useValue: userService },
        { provide: UploadService, useValue: {} },
        { provide: UserDataExportService, useValue: {} },
      ],
    );
  });

  afterEach(() => app.close());

  const routes: [string, (id: string) => request.Test][] = [
    ['GET', (id) => request(app.getHttpServer()).get(`/user/${id}`)],
    [
      'PUT',
      (id) =>
        request(app.getHttpServer()).put(`/user/${id}`).send({ name: 'x' }),
    ],
    ['DELETE', (id) => request(app.getHttpServer()).delete(`/user/${id}`)],
  ];

  describe.each(routes)('%s /user/:id', (_method, call) => {
    it('rejects anonymous callers with 401', async () => {
      await call(BOB).expect(401);
      expect(userService.getUser).not.toHaveBeenCalled();
      expect(userService.updateUser).not.toHaveBeenCalled();
      expect(userService.deleteUserAccount).not.toHaveBeenCalled();
    });

    it("rejects another user's id with 403", async () => {
      await call(BOB).set('Authorization', bearer('alice')).expect(403);
      expect(userService.updateUser).not.toHaveBeenCalled();
      expect(userService.deleteUserAccount).not.toHaveBeenCalled();
    });

    it('allows the account owner and never returns credential hashes', async () => {
      const res = await call(ALICE)
        .set('Authorization', bearer('alice'))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|pinHash/);
    });

    it('allows an admin and never returns credential hashes', async () => {
      const res = await call(BOB)
        .set('Authorization', bearer('admin'))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|pinHash/);
    });
  });

  it('permanent delete by another user is refused before the service runs', async () => {
    await request(app.getHttpServer())
      .delete(`/user/${BOB}?permanent=true`)
      .set('Authorization', bearer('alice'))
      .expect(403);
    expect(userService.deleteUserAccount).not.toHaveBeenCalled();
  });
});
