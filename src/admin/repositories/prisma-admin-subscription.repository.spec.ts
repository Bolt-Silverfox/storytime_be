import { PrismaAdminSubscriptionRepository } from './prisma-admin-subscription.repository';

describe('PrismaAdminSubscriptionRepository excludes the free plan from subscriber metrics', () => {
  const groupBy = jest.fn().mockResolvedValue([]);
  const findMany = jest.fn().mockResolvedValue([]);
  const repo = new PrismaAdminSubscriptionRepository({
    subscription: { groupBy, findMany },
  } as never);

  beforeEach(() => jest.clearAllMocks());

  it('groupByActivePlan (plan breakdown / subscriptionPlans)', async () => {
    await repo.groupByActivePlan(new Date());
    expect(groupBy.mock.calls[0][0].where).toMatchObject({
      status: 'active',
      plan: { not: 'free' },
    });
  });

  it('groupByActivePlan keeps caller filters (paying / complimentary) and still excludes free', async () => {
    await repo.groupByActivePlan(new Date(), { source: 'store' });
    expect(groupBy.mock.calls[0][0].where).toMatchObject({
      source: 'store',
      plan: { not: 'free' },
    });
  });

  it('groupByActiveSource', async () => {
    await repo.groupByActiveSource(new Date());
    expect(groupBy.mock.calls[0][0].where).toMatchObject({
      plan: { not: 'free' },
    });
  });

  it('groupByStartedAt (subscription growth)', async () => {
    await repo.groupByStartedAt(new Date(0), new Date());
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      plan: { not: 'free' },
    });
  });
});
