import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RewardController } from './reward.controller';
import { RewardService } from './reward.service';
import {
  ALICE_KID,
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
});
