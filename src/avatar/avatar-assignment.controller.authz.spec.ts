import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AvatarAssignmentController } from './avatar-assignment.controller';
import { AvatarService } from './avatar.service';
import {
  ADMIN,
  ALICE,
  ALICE_KID,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('AvatarAssignmentController authorization', () => {
  let app: INestApplication;
  const avatars = {
    assignAvatarToUser: jest.fn(),
    assignAvatarToKid: jest.fn(),
    uploadAndAssignUserAvatar: jest.fn(),
    uploadAndAssignKidAvatar: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of Object.values(avatars)) fn.mockResolvedValue({ id: 'x' });
    app = await createAuthzApp(
      [AvatarAssignmentController],
      [{ provide: AvatarService, useValue: avatars }],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());
  const noneCalled = () => {
    for (const fn of Object.values(avatars)) expect(fn).not.toHaveBeenCalled();
  };

  it('rejects anonymous callers on every route with 401', async () => {
    await http()
      .post('/avatars/assign/user')
      .send({ avatarId: 'a', userId: ALICE })
      .expect(401);
    await http()
      .post('/avatars/assign/kid')
      .send({ avatarId: 'a', kidId: ALICE_KID })
      .expect(401);
    await http()
      .post('/avatars/upload/user')
      .field('userId', ALICE)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    await http()
      .post('/avatars/upload/kid')
      .field('kidId', ALICE_KID)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    noneCalled();
  });

  it("refuses assigning or uploading an avatar for another user's account or kid", async () => {
    const bob = bearer('bob');
    await http()
      .post('/avatars/assign/user')
      .set('Authorization', bob)
      .send({ avatarId: 'a', userId: ALICE })
      .expect(403);
    await http()
      .post('/avatars/assign/kid')
      .set('Authorization', bob)
      .send({ avatarId: 'a', kidId: ALICE_KID })
      .expect(403);
    await http()
      .post('/avatars/upload/user')
      .set('Authorization', bob)
      .field('userId', ALICE)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(403);
    await http()
      .post('/avatars/upload/kid')
      .set('Authorization', bob)
      .field('kidId', ALICE_KID)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(403);
    noneCalled();
  });

  it('uses the session user when no userId is sent and when the owner sends their own', async () => {
    const alice = bearer('alice');
    await http()
      .post('/avatars/assign/user')
      .set('Authorization', alice)
      .send({ avatarId: 'a' })
      .expect(201);
    expect(avatars.assignAvatarToUser).toHaveBeenLastCalledWith(ALICE, 'a');
    await http()
      .post('/avatars/upload/user')
      .set('Authorization', alice)
      .field('userId', ALICE)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(avatars.uploadAndAssignUserAvatar).toHaveBeenLastCalledWith(
      ALICE,
      expect.anything(),
      { userId: ALICE, exempt: false },
    );
    await http()
      .post('/avatars/upload/user')
      .set('Authorization', alice)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(avatars.uploadAndAssignUserAvatar).toHaveBeenLastCalledWith(
      ALICE,
      expect.anything(),
      { userId: ALICE, exempt: false },
    );
  });

  it('lets the kid owner and an admin assign kid avatars', async () => {
    await http()
      .post('/avatars/assign/kid')
      .set('Authorization', bearer('alice'))
      .send({ avatarId: 'a', kidId: ALICE_KID })
      .expect(201);
    expect(avatars.assignAvatarToKid).toHaveBeenLastCalledWith(ALICE_KID, 'a');
    await http()
      .post('/avatars/assign/kid')
      .set('Authorization', bearer('admin'))
      .send({ avatarId: 'a', kidId: BOB_KID })
      .expect(201);
    expect(avatars.assignAvatarToKid).toHaveBeenLastCalledWith(BOB_KID, 'a');
    await http()
      .post('/avatars/assign/user')
      .set('Authorization', bearer('admin'))
      .send({ avatarId: 'a', userId: BOB })
      .expect(201);
    expect(avatars.assignAvatarToUser).toHaveBeenLastCalledWith(BOB, 'a');
  });

  it('lets the kid owner and an admin upload kid avatars', async () => {
    await http()
      .post('/avatars/upload/kid')
      .set('Authorization', bearer('alice'))
      .field('kidId', ALICE_KID)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(avatars.uploadAndAssignKidAvatar).toHaveBeenLastCalledWith(
      ALICE_KID,
      expect.objectContaining({ mimetype: 'image/png' }),
      { userId: ALICE, exempt: false },
    );
    await http()
      .post('/avatars/upload/kid')
      .set('Authorization', bearer('admin'))
      .field('kidId', BOB_KID)
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(avatars.uploadAndAssignKidAvatar).toHaveBeenLastCalledWith(
      BOB_KID,
      expect.anything(),
      { userId: ADMIN, exempt: true },
    );
  });
});
