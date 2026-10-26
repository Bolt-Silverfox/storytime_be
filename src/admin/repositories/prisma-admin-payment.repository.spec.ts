import { PrismaAdminPaymentRepository } from './prisma-admin-payment.repository';

describe('PrismaAdminPaymentRepository FX-aware aggregation', () => {
  const queryRaw = jest.fn();
  const findMany = jest.fn();
  const repo = new PrismaAdminPaymentRepository({
    $queryRaw: queryRaw,
    paymentTransaction: { findMany },
  } as never);

  beforeEach(() => jest.resetAllMocks());

  const effective = new Date('2026-01-01T00:00:00Z');

  it('sumRevenueWithRates aggregates in ONE SQL query with a LATERAL rate join (no per-row queries)', async () => {
    queryRaw.mockResolvedValue([
      {
        currency: 'NGN',
        rate: 0.00065,
        effectiveFrom: effective,
        usedEarliest: false,
        amount: 25000,
        count: 5,
      },
      {
        currency: 'NGN',
        rate: 0.001,
        effectiveFrom: effective,
        usedEarliest: true,
        amount: 100,
        count: 1,
      },
      {
        currency: 'USD',
        rate: null,
        effectiveFrom: null,
        usedEarliest: null,
        amount: 9.99,
        count: 1,
      },
      {
        currency: 'GHS',
        rate: null,
        effectiveFrom: null,
        usedEarliest: null,
        amount: 3,
        count: 1,
      },
      {
        currency: null,
        rate: null,
        effectiveFrom: null,
        usedEarliest: null,
        amount: 7,
        count: 2,
      },
    ]);
    const rows = await repo.sumRevenueWithRates();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql: string = queryRaw.mock.calls[0][0].sql;
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('"fx_rates"');
    expect(sql).toContain('t."status" = \'success\'');
    expect(sql).toContain('GROUP BY');
    expect(rows).toEqual([
      {
        currency: 'NGN',
        amount: 25000,
        count: 5,
        rate: { rate: 0.00065, effectiveFrom: effective, usedEarliest: false },
      },
      {
        currency: 'NGN',
        amount: 100,
        count: 1,
        rate: { rate: 0.001, effectiveFrom: effective, usedEarliest: true },
      },
      {
        currency: 'USD',
        amount: 9.99,
        count: 1,
        rate: { rate: 1, effectiveFrom: null, usedEarliest: false },
      },
      { currency: 'GHS', amount: 3, count: 1, rate: null },
      { currency: null, amount: 7, count: 2, rate: null },
    ]);
  });

  it('sumRevenueWithRates can cap by createdAt (previous-period trend)', async () => {
    queryRaw.mockResolvedValue([]);
    const cap = new Date('2026-09-30T23:59:59.999Z');
    await repo.sumRevenueWithRates({ createdAtLte: cap });
    const q = queryRaw.mock.calls[0][0];
    expect(q.sql).toContain('t."createdAt" <=');
    expect(q.values).toContain(cap);
  });

  it('groupRevenueByPlan groups by plan, currency and applied rate in SQL', async () => {
    queryRaw.mockResolvedValue([
      {
        plan: 'monthly',
        currency: 'NGN',
        rate: 0.00065,
        effectiveFrom: effective,
        usedEarliest: false,
        amount: 1,
        count: 1,
      },
      {
        plan: null,
        currency: 'USD',
        rate: null,
        effectiveFrom: null,
        usedEarliest: null,
        amount: 2,
        count: 1,
      },
    ]);
    const rows = await repo.groupRevenueByPlan();
    expect(queryRaw.mock.calls[0][0].sql).toContain('LEFT JOIN LATERAL');
    expect(rows[0]).toMatchObject({
      plan: 'monthly',
      currency: 'NGN',
      amount: 1,
      count: 1,
      rate: { rate: 0.00065, usedEarliest: false },
    });
    expect(rows[1]).toMatchObject({
      plan: null,
      currency: 'USD',
      rate: { rate: 1 },
    });
  });

  it('findSuccessfulInRange selects currency and createdAt, ordered asc', async () => {
    findMany.mockResolvedValue([]);
    await repo.findSuccessfulInRange(new Date(0), new Date());
    expect(findMany.mock.calls[0][0].select).toMatchObject({
      currency: true,
      createdAt: true,
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });

  it('findSuccessfulByUser selects createdAt so each payment converts at its own date', async () => {
    findMany.mockResolvedValue([]);
    await repo.findSuccessfulByUser('u1');
    expect(findMany.mock.calls[0][0].select).toMatchObject({
      amount: true,
      currency: true,
      createdAt: true,
    });
  });
});
