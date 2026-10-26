import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminPaymentRepository } from './prisma-admin-payment.repository';
import {
  FxRateTable,
  summarizeConvertedRevenue,
} from '../utils/fx-conversion.util';

/**
 * Runs the real LATERAL rate-selection SQL against Postgres and checks it
 * agrees with the in-memory FxRateTable rule used for daily/monthly/user
 * figures, so dashboard totals and series can never drift apart.
 * Uses throw-away currency codes so it is safe on a shared database.
 */
describe('PrismaAdminPaymentRepository FX SQL (integration)', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminPaymentRepository;
  let userId: string;
  const d = (s: string) => new Date(`${s}T12:00:00.000Z`);
  const CUR = 'ZQA'; // has two rates
  const NORATE = 'ZQB'; // no rate at all

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminPaymentRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminPaymentRepository);

    const user = await prisma.user.create({
      data: {
        email: `fx-int-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'parent',
      } as never,
    });
    userId = user.id;
    await prisma.fxRate.createMany({
      data: [
        { currency: CUR, rateToUsd: 0.001, effectiveFrom: d('2026-03-01') },
        { currency: CUR, rateToUsd: 0.0005, effectiveFrom: d('2026-06-01') },
      ],
    });
    const tx = (
      reference: string,
      amount: number,
      currency: string | null,
      createdAt: Date,
      extra: object = {},
    ) => ({
      userId,
      reference,
      amount,
      currency,
      status: 'success',
      createdAt,
      plan: 'fx-int-plan',
      ...extra,
    });
    const stamp = Date.now();
    await prisma.paymentTransaction.createMany({
      data: [
        tx(`fx-${stamp}-1`, 1000, CUR, d('2026-01-15')), // before earliest -> earliest 0.001, flagged
        tx(`fx-${stamp}-2`, 1000, CUR, d('2026-04-15')), // 0.001
        tx(`fx-${stamp}-3`, 1000, ` ${CUR.toLowerCase()} `, d('2026-07-15')), // 0.0005, normalized
        tx(`fx-${stamp}-4`, 500, NORATE, d('2026-07-15')), // unconverted
        tx(`fx-${stamp}-5`, 9.99, 'USD', d('2026-07-15')),
        tx(`fx-${stamp}-6`, 7, CUR, d('2026-07-15'), { status: 'failed' }), // ignored
        tx(`fx-${stamp}-7`, 7, CUR, d('2026-07-15'), { deletedAt: new Date() }), // ignored
      ],
    });
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.fxRate.deleteMany({ where: { currency: CUR } });
    await prisma.$disconnect();
  });

  it('sumRevenueWithRates picks the per-date rate in SQL and agrees with FxRateTable', async () => {
    const rows = (await repo.sumRevenueWithRates()).filter((r) =>
      [CUR, NORATE].includes(r.currency ?? ''),
    );
    const sql = summarizeConvertedRevenue(rows);
    expect(sql.convertedRevenueByCurrency).toEqual([
      {
        currency: CUR,
        total: 3000,
        transactions: 3,
        usdTotal: 2.5, // 1 + 1 + 0.5
        rateUsed: 0.0005,
      },
    ]);
    expect(sql.usedEarliestRate).toBe(true);
    expect(sql.unconvertedCurrencies).toEqual([
      { currency: NORATE, total: 500, transactions: 1 },
    ]);

    // in-memory rule over the same transactions gives the same figure
    const txns = await repo.findSuccessfulByUser(userId);
    const table = new FxRateTable(
      (await prisma.fxRate.findMany({ where: { currency: CUR } })).map((r) => ({
        currency: r.currency,
        rateToUsd: r.rateToUsd.toNumber(),
        effectiveFrom: r.effectiveFrom,
      })),
    );
    const mem = summarizeConvertedRevenue(
      txns
        .filter((t) => (t.currency ?? '').trim().toUpperCase() === CUR)
        .map((t) => ({
          currency: t.currency,
          amount: t.amount,
          count: 1,
          rate: table.resolve(t.currency, t.createdAt),
        })),
    );
    expect(mem.totalRevenue).toBe(sql.totalRevenue);
  });

  it('sumRevenueWithRates honours the createdAt cap', async () => {
    const rows = (
      await repo.sumRevenueWithRates({ createdAtLte: d('2026-05-01') })
    ).filter((r) => r.currency === CUR);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(2);
  });

  it('groupRevenueByPlan attributes converted revenue to the payment plan', async () => {
    const rows = (await repo.groupRevenueByPlan()).filter(
      (r) => r.plan === 'fx-int-plan',
    );
    const s = summarizeConvertedRevenue(rows);
    expect(s.totalRevenue).toBe(12.49); // 2.5 + 9.99
    expect(s.unconvertedCurrencies).toEqual([
      { currency: NORATE, total: 500, transactions: 1 },
    ]);
  });
});
