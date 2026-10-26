import { PrismaAdminPaymentRepository } from './prisma-admin-payment.repository';

describe('PrismaAdminPaymentRepository per-currency aggregation', () => {
  const groupBy = jest.fn();
  const findMany = jest.fn();
  const repo = new PrismaAdminPaymentRepository({
    paymentTransaction: { groupBy, findMany },
  } as never);

  beforeEach(() => jest.resetAllMocks());

  it('sumRevenueByCurrency groups by currency in the DB', async () => {
    groupBy.mockResolvedValue([
      { currency: 'NGN', _sum: { amount: 25000 }, _count: 5 },
      { currency: null, _sum: { amount: null }, _count: 1 },
    ]);
    const rows = await repo.sumRevenueByCurrency({ status: 'success' });
    expect(groupBy.mock.calls[0][0]).toMatchObject({
      by: ['currency'],
      where: { status: 'success' },
    });
    expect(rows).toEqual([
      { currency: 'NGN', amount: 25000, count: 5 },
      { currency: null, amount: 0, count: 1 },
    ]);
  });

  it('daily revenue buckets by UTC day AND currency (never a single mixed number)', async () => {
    findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-10-01T09:00:00Z'),
        amount: 5000,
        currency: 'NGN',
      },
      {
        createdAt: new Date('2026-10-01T23:00:00Z'),
        amount: 4.99,
        currency: 'usd',
      },
      {
        createdAt: new Date('2026-10-01T23:30:00Z'),
        amount: 5,
        currency: 'USD',
      },
      {
        createdAt: new Date('2026-10-02T01:00:00Z'),
        amount: 7,
        currency: null,
      },
    ]);
    const days = await repo.groupRevenueByCreatedAtOrdered(
      new Date('2026-10-01'),
      new Date('2026-10-31'),
    );
    expect(findMany.mock.calls[0][0].select).toMatchObject({ currency: true });
    expect(days).toEqual([
      {
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        byCurrency: { NGN: 5000, USD: 9.99 },
      },
      {
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        byCurrency: { UNKNOWN: 7 },
      },
    ]);
  });

  it('groupRevenueByPlan groups by plan and currency', async () => {
    groupBy.mockResolvedValue([
      { plan: 'monthly', currency: 'NGN', _sum: { amount: 1 }, _count: 1 },
    ]);
    const rows = await repo.groupRevenueByPlan();
    expect(groupBy.mock.calls[0][0].by).toEqual(['plan', 'currency']);
    expect(rows[0]).toMatchObject({ plan: 'monthly', currency: 'NGN' });
  });

  it('findSuccessfulInRange selects the currency', async () => {
    findMany.mockResolvedValue([]);
    await repo.findSuccessfulInRange(new Date(0), new Date());
    expect(findMany.mock.calls[0][0].select).toMatchObject({ currency: true });
  });
});
