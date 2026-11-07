import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import {
  ALICE,
  ALICE_KID,
  BOB,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const PREF_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('NotificationController (preferences) authorization', () => {
  let app: INestApplication;
  const notifications = {
    create: jest.fn(),
    update: jest.fn(),
    bulkUpdate: jest.fn(),
    getForUser: jest.fn(),
    getForKid: jest.fn(),
    getById: jest.fn(),
    getPreferenceOwner: jest.fn(),
    delete: jest.fn(),
    undoDelete: jest.fn(),
  };
  const mutators = ['create', 'update', 'delete', 'undoDelete'] as const;

  beforeEach(async () => {
    jest.clearAllMocks();
    notifications.getForUser.mockResolvedValue([]);
    notifications.getForKid.mockResolvedValue([]);
    notifications.getById.mockResolvedValue({ id: PREF_ID, userId: ALICE });
    notifications.getPreferenceOwner.mockResolvedValue({ userId: ALICE });
    notifications.create.mockImplementation(async (dto) => dto);
    app = await createAuthzApp(
      [NotificationController],
      [{ provide: NotificationService, useValue: notifications }],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  it.each([
    ['get', `/notification-preferences/users/${ALICE}`],
    ['get', `/notification-preferences/kids/${ALICE_KID}`],
    ['get', `/notification-preferences/${PREF_ID}`],
    ['patch', `/notification-preferences/${PREF_ID}`],
    ['delete', `/notification-preferences/${PREF_ID}?permanent=true`],
    ['post', `/notification-preferences/${PREF_ID}/undo-delete`],
    ['post', '/notification-preferences'],
  ])('%s %s rejects anonymous callers with 401', async (method, url) => {
    await (http() as never as Record<string, (u: string) => request.Test>)
      [method](url)
      .send({})
      .expect(401);
    for (const m of mutators) expect(notifications[m]).not.toHaveBeenCalled();
    expect(notifications.getForUser).not.toHaveBeenCalled();
    expect(notifications.getForKid).not.toHaveBeenCalled();
  });

  it('lists preferences for self, the kid parent and admin only', async () => {
    await http()
      .get(`/notification-preferences/users/${ALICE}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/notification-preferences/users/${ALICE}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/notification-preferences/kids/${ALICE_KID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/notification-preferences/kids/${ALICE_KID}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it("refuses reading, changing, deleting or restoring another user's preference", async () => {
    const bob = bearer('bob');
    await http()
      .get(`/notification-preferences/${PREF_ID}`)
      .set('Authorization', bob)
      .expect(403);
    await http()
      .patch(`/notification-preferences/${PREF_ID}`)
      .set('Authorization', bob)
      .send({ enabled: false })
      .expect(403);
    await http()
      .delete(`/notification-preferences/${PREF_ID}?permanent=true`)
      .set('Authorization', bob)
      .expect(403);
    await http()
      .post(`/notification-preferences/${PREF_ID}/undo-delete`)
      .set('Authorization', bob)
      .expect(403);
    for (const m of mutators) expect(notifications[m]).not.toHaveBeenCalled();
  });

  it('lets the owner and an admin delete a preference', async () => {
    await http()
      .delete(`/notification-preferences/${PREF_ID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .delete(`/notification-preferences/${PREF_ID}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
    expect(notifications.delete).toHaveBeenCalledTimes(2);
  });

  it('refuses creating a preference for another user and binds the default to the session', async () => {
    const body = { type: 'push', category: 'NewStory', enabled: true };
    await http()
      .post('/notification-preferences')
      .set('Authorization', bearer('alice'))
      .send([{ ...body, userId: BOB }])
      .expect(403);
    expect(notifications.create).not.toHaveBeenCalled();

    await http()
      .post('/notification-preferences')
      .set('Authorization', bearer('alice'))
      .send([body])
      .expect(201);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ALICE }),
    );
  });
});
