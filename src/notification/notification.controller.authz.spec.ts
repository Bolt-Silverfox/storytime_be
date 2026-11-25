import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import {
  ALICE,
  ALICE_KID,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const PREF_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('NotificationController (preferences) authorization', () => {
  let app: INestApplication;
  const notifications = {
    createMany: jest.fn(),
    update: jest.fn(),
    bulkUpdate: jest.fn(),
    getForUser: jest.fn(),
    getForKid: jest.fn(),
    getById: jest.fn(),
    getPreferenceOwner: jest.fn(),
    delete: jest.fn(),
    undoDelete: jest.fn(),
  };
  const mutators = ['createMany', 'update', 'delete', 'undoDelete'] as const;

  beforeEach(async () => {
    jest.clearAllMocks();
    notifications.getForUser.mockResolvedValue([]);
    notifications.getForKid.mockResolvedValue([]);
    notifications.getById.mockResolvedValue({ id: PREF_ID, userId: ALICE });
    notifications.getPreferenceOwner.mockResolvedValue({ userId: ALICE });
    notifications.createMany.mockImplementation((dtos) =>
      Promise.resolve(dtos),
    );
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

  it.each([{ userId: BOB }, { kidId: BOB_KID }])(
    'rejects %j on a single update so ownership cannot be reassigned',
    async (body) => {
      await http()
        .patch(`/notification-preferences/${PREF_ID}`)
        .set('Authorization', bearer('alice'))
        .send({ enabled: false, ...body })
        .expect(400);
      expect(notifications.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['get', `/notification-preferences/${PREF_ID}`],
    ['patch', `/notification-preferences/${PREF_ID}`],
    ['delete', `/notification-preferences/${PREF_ID}`],
    ['post', `/notification-preferences/${PREF_ID}/undo-delete`],
  ])(
    '%s %s answers a missing preference with 403, like a foreign one',
    async (method, url) => {
      notifications.getPreferenceOwner.mockRejectedValue(
        new NotFoundException(),
      );
      await (http() as never as Record<string, (u: string) => request.Test>)
        [method](url)
        .set('Authorization', bearer('alice'))
        .send(method === 'patch' ? { enabled: false } : {})
        .expect(403);
      for (const m of mutators) expect(notifications[m]).not.toHaveBeenCalled();
      expect(notifications.getById).not.toHaveBeenCalled();
    },
  );

  it('gives the same 403 body for a missing, foreign-user and foreign-kid preference', async () => {
    const bodies: unknown[] = [];
    const denied = async () => {
      const res = await http()
        .get(`/notification-preferences/${PREF_ID}`)
        .set('Authorization', bearer('alice'))
        .expect(403);
      bodies.push(res.body);
    };
    notifications.getPreferenceOwner.mockRejectedValueOnce(
      new NotFoundException(),
    );
    await denied();
    notifications.getPreferenceOwner.mockResolvedValueOnce({ userId: BOB });
    await denied();
    notifications.getPreferenceOwner.mockResolvedValueOnce({
      userId: null,
      kidId: BOB_KID,
    });
    await denied();
    notifications.getPreferenceOwner.mockResolvedValueOnce({
      userId: ALICE,
      kidId: BOB_KID,
    });
    await denied();
    notifications.getPreferenceOwner.mockResolvedValueOnce({
      userId: BOB,
      kidId: ALICE_KID,
    });
    await denied();
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  describe('a preference carrying both userId and kidId needs both owners', () => {
    const send = (
      method: 'patch' | 'delete',
      who: 'alice' | 'bob' | 'admin',
    ) =>
      method === 'patch'
        ? http()
            .patch(`/notification-preferences/${PREF_ID}`)
            .set('Authorization', bearer(who))
            .send({ enabled: false })
        : http()
            .delete(`/notification-preferences/${PREF_ID}?permanent=true`)
            .set('Authorization', bearer(who));
    const serviceCall = { patch: 'update', delete: 'delete' } as const;

    describe.each(['patch', 'delete'] as const)('%s', (method) => {
      it("refuses both parents when the user is alice and the kid is bob's", async () => {
        notifications.getPreferenceOwner.mockResolvedValue({
          userId: ALICE,
          kidId: BOB_KID,
        });
        await send(method, 'bob').expect(403);
        await send(method, 'alice').expect(403);
        expect(notifications[serviceCall[method]]).not.toHaveBeenCalled();
      });

      it('allows the owner whose user and kid both match, and an admin', async () => {
        notifications.getPreferenceOwner.mockResolvedValue({
          userId: ALICE,
          kidId: ALICE_KID,
        });
        await send(method, 'bob').expect(403);
        expect(notifications[serviceCall[method]]).not.toHaveBeenCalled();
        await send(method, 'alice').expect(200);
        await send(method, 'admin').expect(200);
        expect(notifications[serviceCall[method]]).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('lists hide a dual-owner preference from the other owner', () => {
    const mixed = {
      id: PREF_ID,
      type: 'push',
      category: 'NEW_LOGIN',
      enabled: true,
      userId: ALICE,
      kidId: BOB_KID,
    };
    const own = { ...mixed, id: 'own-row', userId: ALICE, kidId: ALICE_KID };
    const userOnly = { ...mixed, id: 'user-row', kidId: undefined };
    const ids = (res: { body: { id: string }[] }) => res.body.map((r) => r.id);

    it("omits the row from alice's user list and keeps her own rows", async () => {
      notifications.getForUser.mockResolvedValue([mixed, own, userOnly]);
      const res = await http()
        .get(`/notification-preferences/users/${ALICE}`)
        .set('Authorization', bearer('alice'))
        .expect(200);
      expect(ids(res)).toEqual(['own-row', 'user-row']);
    });

    it("omits the row from bob's kid list", async () => {
      notifications.getForKid.mockResolvedValue([mixed]);
      const res = await http()
        .get(`/notification-preferences/kids/${BOB_KID}`)
        .set('Authorization', bearer('bob'))
        .expect(200);
      expect(ids(res)).toEqual([]);
    });

    it('shows the row to an admin on both lists', async () => {
      notifications.getForUser.mockResolvedValue([mixed]);
      notifications.getForKid.mockResolvedValue([mixed]);
      const byUser = await http()
        .get(`/notification-preferences/users/${ALICE}`)
        .set('Authorization', bearer('admin'))
        .expect(200);
      const byKid = await http()
        .get(`/notification-preferences/kids/${BOB_KID}`)
        .set('Authorization', bearer('admin'))
        .expect(200);
      expect(ids(byUser)).toEqual([PREF_ID]);
      expect(ids(byKid)).toEqual([PREF_ID]);
    });
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
    const body = { type: 'push', category: 'NEW_LOGIN', enabled: true };
    await http()
      .post('/notification-preferences')
      .set('Authorization', bearer('alice'))
      .send([{ ...body, userId: BOB }])
      .expect(403);
    expect(notifications.createMany).not.toHaveBeenCalled();

    await http()
      .post('/notification-preferences')
      .set('Authorization', bearer('alice'))
      .send([body])
      .expect(201);
    expect(notifications.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: ALICE }),
    ]);
  });

  describe('POST /notification-preferences body validation and kid ownership', () => {
    const valid = { type: 'push', category: 'NEW_LOGIN', enabled: true };
    const post = (who: 'alice' | 'admin', body: unknown) =>
      http()
        .post('/notification-preferences')
        .set('Authorization', bearer(who))
        .send(body as object);

    it("refuses a preference for another parent's kid", async () => {
      await post('alice', [{ ...valid, kidId: BOB_KID }]).expect(403);
      expect(notifications.createMany).not.toHaveBeenCalled();
    });

    it('accepts a preference for own kid', async () => {
      await post('alice', [{ ...valid, kidId: ALICE_KID }]).expect(201);
      expect(notifications.createMany).toHaveBeenCalledTimes(1);
      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ kidId: ALICE_KID }),
      ]);
    });

    it('rejects more than 50 preferences in one request', async () => {
      await post(
        'alice',
        Array.from({ length: 51 }, () => valid),
      ).expect(400);
      expect(notifications.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-array body', valid],
      ['an extra property', [{ ...valid, role: 'admin' }]],
      ['an unknown enum value', [{ ...valid, type: 'carrier-pigeon' }]],
      ['a string boolean', [{ ...valid, enabled: 'false' }]],
      ['an operator object as kidId', [{ ...valid, kidId: { not: 'z' } }]],
      [
        'an in-list object as kidId',
        [{ ...valid, kidId: { in: [BOB_KID, ALICE_KID] } }],
      ],
      ['a non-uuid userId', [{ ...valid, userId: 'not-a-uuid' }]],
    ])('rejects %s with 400 before touching the service', async (_l, body) => {
      await post('alice', body).expect(400);
      await post('admin', body).expect(400);
      expect(notifications.createMany).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /notification-preferences (bulk) body validation', () => {
    const patch = (body: unknown) =>
      http()
        .patch('/notification-preferences')
        .set('Authorization', bearer('alice'))
        .send(body as object);

    it('refuses a dual-owner preference whose kid belongs to another parent and updates nothing', async () => {
      notifications.getPreferenceOwner.mockResolvedValue({
        userId: ALICE,
        kidId: BOB_KID,
      });
      await patch([{ id: PREF_ID, enabled: false }]).expect(403);
      expect(notifications.bulkUpdate).not.toHaveBeenCalled();
    });

    it('checks every id in the batch, not only the first', async () => {
      const OTHER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      notifications.getPreferenceOwner.mockImplementation((id: string) =>
        Promise.resolve(
          id === OTHER_ID
            ? { userId: ALICE, kidId: BOB_KID }
            : { userId: ALICE },
        ),
      );
      await patch([
        { id: PREF_ID, enabled: false },
        { id: OTHER_ID, enabled: false },
      ]).expect(403);
      expect(notifications.bulkUpdate).not.toHaveBeenCalled();
    });

    it('accepts a valid array', async () => {
      notifications.bulkUpdate.mockResolvedValue([]);
      await patch([{ id: PREF_ID, enabled: false }]).expect(200);
      expect(notifications.bulkUpdate).toHaveBeenCalledWith([
        expect.objectContaining({ id: PREF_ID, enabled: false }),
      ]);
    });

    it('lets a parent bulk-update a kid-only preference for their own kid', async () => {
      notifications.getPreferenceOwner.mockResolvedValue({
        userId: null,
        kidId: ALICE_KID,
      });
      notifications.bulkUpdate.mockResolvedValue([]);
      await patch([{ id: PREF_ID, enabled: false }]).expect(200);
      expect(notifications.bulkUpdate).toHaveBeenCalledWith([
        expect.objectContaining({ id: PREF_ID }),
      ]);
    });

    it("lets an admin bulk-update another user's preferences", async () => {
      notifications.getPreferenceOwner.mockResolvedValue({ userId: BOB });
      notifications.bulkUpdate.mockResolvedValue([]);
      await http()
        .patch('/notification-preferences')
        .set('Authorization', bearer('admin'))
        .send([{ id: PREF_ID, enabled: false }])
        .expect(200);
      expect(notifications.bulkUpdate).toHaveBeenCalledTimes(1);
    });

    it("refuses another user's kid-only preference and updates nothing", async () => {
      notifications.getPreferenceOwner.mockResolvedValue({
        userId: null,
        kidId: BOB_KID,
      });
      await patch([{ id: PREF_ID, enabled: false }]).expect(403);
      expect(notifications.bulkUpdate).not.toHaveBeenCalled();
    });

    it('answers a missing preference id the same way as a foreign one', async () => {
      notifications.getPreferenceOwner.mockResolvedValueOnce({ userId: BOB });
      const foreign = await patch([{ id: PREF_ID, enabled: false }]).expect(
        403,
      );
      notifications.getPreferenceOwner.mockRejectedValueOnce(
        new NotFoundException(),
      );
      const missing = await patch([{ id: PREF_ID, enabled: false }]).expect(
        403,
      );
      expect(missing.body).toEqual(foreign.body);
      expect(notifications.bulkUpdate).not.toHaveBeenCalled();
    });

    it('rejects an oversized batch on the size cap before validating items', async () => {
      const oversized = Array.from({ length: 51 }, () => ({
        id: 'not-a-uuid',
        enabled: 'nope',
        extra: true,
      }));
      const res = await patch(oversized).expect(400);
      expect(JSON.stringify(res.body)).toContain('At most 50 preferences');
      expect(notifications.getPreferenceOwner).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-array body', { id: PREF_ID, enabled: false }],
      ['an extra property', [{ id: PREF_ID, enabled: false, userId: BOB }]],
      ['a string boolean', [{ id: PREF_ID, enabled: 'false' }]],
      ['a non-uuid id', [{ id: 'x', enabled: false }]],
      ['an operator object id', [{ id: { not: 'z' }, enabled: false }]],
      [
        'more than 50 items',
        Array.from({ length: 51 }, () => ({ id: PREF_ID, enabled: true })),
      ],
    ])('rejects %s with 400', async (_l, body) => {
      await patch(body).expect(400);
      expect(notifications.bulkUpdate).not.toHaveBeenCalled();
    });
  });
});
