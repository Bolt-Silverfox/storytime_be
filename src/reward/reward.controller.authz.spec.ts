import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import { RewardController } from './reward.controller';
import { RewardService } from './reward.service';
import {
  ALICE,
  ALICE_DELETED_KID,
  ALICE_KID,
  BOB,
  BOB_KID,
  bearer,
  createAuthzApp,
} from '@/shared/testing/authz-harness';

const REWARD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('RewardController authorization', () => {
  let app: INestApplication;
  const rewards = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByKid: jest.fn(),
    redeemReward: jest.fn(),
    updateRedemptionStatus: jest.fn(),
    getRedemptionsForKid: jest.fn(),
    getRedemptionById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    rewards.findAll.mockResolvedValue([{ id: REWARD_ID, kidId: ALICE_KID }]);
    rewards.findOne.mockResolvedValue({ id: REWARD_ID, kidId: ALICE_KID });
    rewards.findByKid.mockResolvedValue([]);
    rewards.delete.mockResolvedValue({ id: REWARD_ID });
    rewards.update.mockResolvedValue({ id: REWARD_ID });
    rewards.getRedemptionsForKid.mockResolvedValue([]);
    rewards.getRedemptionById.mockResolvedValue({
      id: REWARD_ID,
      kidId: ALICE_KID,
    });
    app = await createAuthzApp(
      [RewardController],
      [{ provide: RewardService, useValue: rewards }],
    );
  });

  afterEach(() => app.close());

  const http = () => request(app.getHttpServer());

  it.each([
    ['get', '/rewards'],
    ['get', `/rewards/kid/${ALICE_KID}`],
    ['get', `/rewards/${REWARD_ID}`],
    ['delete', `/rewards/${REWARD_ID}`],
    ['patch', `/rewards/${REWARD_ID}`],
    ['post', '/rewards'],
    ['post', '/rewards/redeem'],
    ['patch', '/rewards/redemption/status'],
    ['get', `/rewards/redemption/kid/${ALICE_KID}`],
    ['get', `/rewards/redemption/${REWARD_ID}`],
  ])('%s %s rejects anonymous callers with 401', async (method, url) => {
    await (http() as never as Record<string, (u: string) => request.Test>)
      [method](url)
      .send({})
      .expect(401);
    for (const fn of Object.values(rewards)) expect(fn).not.toHaveBeenCalled();
  });

  it('lists every reward for admins only', async () => {
    await http()
      .get('/rewards')
      .set('Authorization', bearer('alice'))
      .expect(403);
    await http()
      .get('/rewards')
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it("refuses another parent's kid rewards and allows the owner", async () => {
    await http()
      .get(`/rewards/kid/${ALICE_KID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/rewards/kid/${ALICE_KID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    await http()
      .get(`/rewards/kid/${BOB_KID}`)
      .set('Authorization', bearer('admin'))
      .expect(200);
  });

  it("refuses deleting another parent's reward and allows the owner", async () => {
    await http()
      .delete(`/rewards/${REWARD_ID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    expect(rewards.delete).not.toHaveBeenCalled();
    await http()
      .delete(`/rewards/${REWARD_ID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
    expect(rewards.delete).toHaveBeenCalledWith(REWARD_ID);
  });

  it("refuses reading another parent's redemption", async () => {
    await http()
      .get(`/rewards/redemption/${REWARD_ID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/rewards/redemption/${REWARD_ID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);
  });

  it("refuses reading or updating another parent's reward by id", async () => {
    await http()
      .get(`/rewards/${REWARD_ID}`)
      .set('Authorization', bearer('bob'))
      .expect(403);
    await http()
      .get(`/rewards/${REWARD_ID}`)
      .set('Authorization', bearer('alice'))
      .expect(200);

    const controller = app.get(RewardController);
    const asUser = (userId: string) =>
      ({ authUserData: { userId, userRole: 'user' } }) as never;
    await expect(
      controller.update(REWARD_ID, {}, asUser(BOB)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rewards.update).not.toHaveBeenCalled();
    await controller.update(REWARD_ID, {}, asUser(ALICE));
    expect(rewards.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a soft-deleted kid even for its parent', async () => {
    await http()
      .get(`/rewards/kid/${ALICE_DELETED_KID}`)
      .set('Authorization', bearer('alice'))
      .expect(403);
    expect(rewards.findByKid).not.toHaveBeenCalled();
  });

  it('create with no kidId is rejected before any write, for users and admins', async () => {
    const controller = app.get(RewardController);
    for (const userRole of ['user', 'admin']) {
      const req = { authUserData: { userId: ALICE, userRole } } as never;
      await expect(
        controller.create({ name: 'n', points: 1 } as never, req),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(rewards.create).not.toHaveBeenCalled();
  });

  it('rejects creating, redeeming or approving against a kid the caller does not own', async () => {
    const controller = app.get(RewardController);
    const bobReq = { authUserData: { userId: BOB, userRole: 'user' } } as never;
    await expect(
      controller.create({ name: 'n', points: 1, kidId: ALICE_KID }, bobReq),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.redeemReward(
        { rewardId: REWARD_ID, kidId: ALICE_KID },
        bobReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.updateRedemptionStatus(
        { redemptionId: REWARD_ID, status: 'approved' },
        bobReq,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rewards.create).not.toHaveBeenCalled();
    expect(rewards.redeemReward).not.toHaveBeenCalled();
    expect(rewards.updateRedemptionStatus).not.toHaveBeenCalled();
  });
  describe('redeem binds the reward to the authorised kid', () => {
    const aliceReq = {
      authUserData: { userId: ALICE, userRole: 'user' },
    } as never;

    it("refuses redeeming another family's reward against the caller's own kid", async () => {
      rewards.findOne.mockResolvedValue({ id: REWARD_ID, kidId: BOB_KID });
      const controller = app.get(RewardController);
      await expect(
        controller.redeemReward(
          { rewardId: REWARD_ID, kidId: ALICE_KID },
          aliceReq,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rewards.redeemReward).not.toHaveBeenCalled();
    });

    it('answers an unknown reward id the same way as a foreign one', async () => {
      rewards.findOne.mockRejectedValue(new NotFoundException());
      const controller = app.get(RewardController);
      await expect(
        controller.redeemReward(
          { rewardId: REWARD_ID, kidId: ALICE_KID },
          aliceReq,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rewards.redeemReward).not.toHaveBeenCalled();
    });

    it('refuses an admin redeeming a reward that belongs to a different kid', async () => {
      rewards.findOne.mockResolvedValue({ id: REWARD_ID, kidId: BOB_KID });
      const controller = app.get(RewardController);
      const adminReq = {
        authUserData: { userId: ALICE, userRole: 'admin' },
      } as never;
      await expect(
        controller.redeemReward(
          { rewardId: REWARD_ID, kidId: ALICE_KID },
          adminReq,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(rewards.redeemReward).not.toHaveBeenCalled();
    });

    it("allows redeeming the kid's own reward", async () => {
      rewards.findOne.mockResolvedValue({ id: REWARD_ID, kidId: ALICE_KID });
      rewards.redeemReward.mockResolvedValue({ id: 'r1' });
      const controller = app.get(RewardController);
      const dto = { rewardId: REWARD_ID, kidId: ALICE_KID };
      await controller.redeemReward(dto, aliceReq);
      expect(rewards.redeemReward).toHaveBeenCalledWith(dto);
    });
  });

  describe('request body validation', () => {
    const asAlice = (req: request.Test) =>
      req.set('Authorization', bearer('alice'));

    beforeEach(() => {
      rewards.create.mockResolvedValue({ id: REWARD_ID });
      rewards.redeemReward.mockResolvedValue({ id: 'r1' });
      rewards.updateRedemptionStatus.mockResolvedValue({ id: 'r1' });
    });

    it('POST /rewards accepts a valid body and rejects unknown properties', async () => {
      const body = {
        name: 'Ice cream',
        description: 'treat',
        points: 10,
        imageUrl: 'https://example.com/a.png',
        kidId: ALICE_KID,
      };
      await asAlice(http().post('/rewards').send(body)).expect(201);
      expect(rewards.create).toHaveBeenCalledWith(body);
      await asAlice(
        http()
          .post('/rewards')
          .send({ ...body, extra: 1 }),
      ).expect(400);
      await asAlice(
        http()
          .post('/rewards')
          .send({ ...body, points: 'ten' }),
      ).expect(400);
      expect(rewards.create).toHaveBeenCalledTimes(1);
    });

    it('rejects null for non-nullable update fields and out-of-range points', async () => {
      const patch = (body: object) =>
        asAlice(http().patch(`/rewards/${REWARD_ID}`).send(body));
      await patch({ name: null }).expect(400);
      await patch({ points: null }).expect(400);
      await patch({ points: 3_000_000_000 }).expect(400);
      await patch({ points: 2_147_483_647 }).expect(200);
      expect(rewards.update).toHaveBeenCalledTimes(1);
    });

    it('rejects negative and overflowing points on create', async () => {
      const body = { name: 'n', kidId: ALICE_KID };
      const create = (points: number) =>
        asAlice(
          http()
            .post('/rewards')
            .send({ ...body, points }),
        );
      await create(-1).expect(400);
      await create(3_000_000_000).expect(400);
      await create(2_147_483_647).expect(201);
      expect(rewards.create).toHaveBeenCalledTimes(1);
    });

    it('PATCH /rewards/:id accepts a partial body and rejects unknown properties', async () => {
      await asAlice(
        http().patch(`/rewards/${REWARD_ID}`).send({ points: 5, name: 'n' }),
      ).expect(200);
      expect(rewards.update).toHaveBeenCalledTimes(1);
      await asAlice(
        http().patch(`/rewards/${REWARD_ID}`).send({ kidId: BOB_KID }),
      ).expect(400);
      expect(rewards.update).toHaveBeenCalledTimes(1);
    });

    it('POST /rewards/redeem accepts a valid body and rejects unknown properties', async () => {
      const body = { rewardId: REWARD_ID, kidId: ALICE_KID };
      await asAlice(http().post('/rewards/redeem').send(body)).expect(201);
      expect(rewards.redeemReward).toHaveBeenCalledWith(body);
      await asAlice(
        http()
          .post('/rewards/redeem')
          .send({ ...body, extra: true }),
      ).expect(400);
      expect(rewards.redeemReward).toHaveBeenCalledTimes(1);
    });

    it('PATCH /rewards/redemption/status accepts a known status and rejects others', async () => {
      const body = { redemptionId: REWARD_ID, status: 'approved' };
      await asAlice(
        http().patch('/rewards/redemption/status').send(body),
      ).expect(200);
      expect(rewards.updateRedemptionStatus).toHaveBeenCalledWith(body);
      await asAlice(
        http()
          .patch('/rewards/redemption/status')
          .send({ ...body, extra: 1 }),
      ).expect(400);
      await asAlice(
        http()
          .patch('/rewards/redemption/status')
          .send({ ...body, status: 'bogus' }),
      ).expect(400);
      expect(rewards.updateRedemptionStatus).toHaveBeenCalledTimes(1);
    });
  });
});
