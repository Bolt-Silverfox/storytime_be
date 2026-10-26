import { Test, TestingModule } from '@nestjs/testing';
import { AdminUserService } from './admin-user.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
} from './repositories';
import { AdminFxRateService } from './admin-fx-rate.service';
import { FxRateTable } from './utils/fx-conversion.util';

const NGN_RATES = new FxRateTable([
  {
    currency: 'NGN',
    rateToUsd: 0.001,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  },
  {
    currency: 'NGN',
    rateToUsd: 0.0005,
    effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  },
]);
const at = (iso: string) => new Date(iso);

const future = new Date(Date.now() + 30 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

const listUser = (subscription: Record<string, unknown> | null, txns = []) => ({
  id: 'u1',
  email: 'a@b.c',
  createdAt: new Date(),
  passwordHash: 'x',
  pinHash: null,
  kids: [],
  usage: null,
  subscription,
  paymentTransactions: txns,
  _count: { kids: 0, auth: 0, parentFavorites: 0, paymentTransactions: 0 },
});

describe('AdminUserService complimentary vs paying', () => {
  let service: AdminUserService;
  const userRepo = {
    findManyWithDetails: jest.fn(),
    count: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findById: jest.fn(),
  };
  const paymentRepo = { findSuccessfulByUser: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    userRepo.count.mockResolvedValue(1);
    paymentRepo.findSuccessfulByUser.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        { provide: ADMIN_USER_REPOSITORY, useValue: userRepo },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: paymentRepo },
        {
          provide: AdminFxRateService,
          useValue: { getRateTable: jest.fn().mockResolvedValue(NGN_RATES) },
        },
      ],
    }).compile();
    service = module.get(AdminUserService);
  });

  const row = async (sub: Record<string, unknown> | null, txns = []) => {
    userRepo.findManyWithDetails.mockResolvedValue([listUser(sub, txns)]);
    const res = await service.getAllUsers({});
    return res.data[0];
  };

  it('keeps isPaidUser true for a comped user (access unchanged) but flags isComplimentary', async () => {
    const u = await row({
      id: 's',
      plan: 'yearly',
      status: 'active',
      endsAt: future,
      source: 'admin_grant',
      grantedByAdminId: 'admin-9',
      grantReason: 'press',
    });
    expect(u.isPaidUser).toBe(true);
    expect(u.isComplimentary).toBe(true);
    expect(u.amountSpent).toBe(0);
    expect(u.activeSubscription).toMatchObject({
      source: 'admin_grant',
      grantReason: 'press',
    });
  });

  it('a store subscriber is paid and not complimentary', async () => {
    const u = await row({
      id: 's',
      plan: 'monthly',
      status: 'active',
      endsAt: future,
      source: 'store',
    });
    expect(u.isPaidUser).toBe(true);
    expect(u.isComplimentary).toBe(false);
  });

  it('an expired grant and a user with no subscription are neither paid nor complimentary', async () => {
    const expired = await row({
      id: 's',
      plan: 'yearly',
      status: 'active',
      endsAt: past,
      source: 'admin_grant',
    });
    expect(expired.isPaidUser).toBe(false);
    expect(expired.isComplimentary).toBe(false);
    const none = await row(null);
    expect(none.isPaidUser).toBe(false);
    expect(none.isComplimentary).toBe(false);
  });

  it('amountSpent is converted to USD with currency USD; spendingByCurrency keeps original amounts', async () => {
    const u = await row(null, [
      { amount: 4.99, currency: 'USD', createdAt: at('2026-03-01') },
      { amount: 47.99, currency: 'USD', createdAt: at('2026-03-02') },
      { amount: 1000, currency: 'NGN', createdAt: at('2026-03-03') },
    ] as never);
    expect(u.spendingByCurrency).toEqual({ USD: 52.98, NGN: 1000 });
    // 52.98 + 1000 * 0.001 (rate effective on 2026-03-03) = 53.98
    expect(u.amountSpent).toBe(53.98);
    expect(u.currency).toBe('USD');
    expect(u.unconvertedSpendingByCurrency).toEqual({});
  });

  it('each payment converts at the rate effective on its own date', async () => {
    const u = await row(null, [
      { amount: 1000, currency: 'NGN', createdAt: at('2026-03-03') }, // 1.00
      { amount: 1000, currency: 'NGN', createdAt: at('2026-07-03') }, // 0.50
      { amount: 1000, currency: 'NGN', createdAt: at('2025-07-03') }, // earliest -> 1.00
    ] as never);
    expect(u.amountSpent).toBe(2.5);
  });

  it('single currency USD is unchanged', async () => {
    const u = await row(null, [
      { amount: 4.99, currency: 'USD', createdAt: at('2026-03-01') },
      { amount: 47.99, currency: 'usd', createdAt: at('2026-03-02') },
    ] as never);
    expect(u.amountSpent).toBe(52.98);
    expect(u.currency).toBe('USD');
    expect(u.spendingByCurrency).toEqual({ USD: 52.98 });
  });

  it('no transactions -> 0 USD', async () => {
    const u = await row(null, []);
    expect(u.amountSpent).toBe(0);
    expect(u.currency).toBe('USD');
    expect(u.spendingByCurrency).toEqual({});
  });

  it('currencies without a rate (incl. UNKNOWN) are excluded from amountSpent and listed', async () => {
    const only = await row(null, [
      { amount: 3, currency: null, createdAt: at('2026-03-01') },
    ] as never);
    expect(only.spendingByCurrency).toEqual({ UNKNOWN: 3 });
    expect(only.amountSpent).toBe(0);
    expect(only.unconvertedSpendingByCurrency).toEqual({ UNKNOWN: 3 });

    const mixed = await row(null, [
      { amount: 3, currency: 'GHS', createdAt: at('2026-03-01') },
      { amount: 5, currency: 'USD', createdAt: at('2026-03-01') },
    ] as never);
    expect(mixed.spendingByCurrency).toEqual({ GHS: 3, USD: 5 });
    expect(mixed.amountSpent).toBe(5);
    expect(mixed.unconvertedSpendingByCurrency).toEqual({ GHS: 3 });
  });

  it('getUserById converts the same way', async () => {
    userRepo.findByIdWithDetails.mockResolvedValue(listUser(null));
    paymentRepo.findSuccessfulByUser.mockResolvedValue([
      { amount: 2000, currency: 'NGN', createdAt: at('2026-03-01') },
      { amount: 7, currency: 'USD', createdAt: at('2026-03-01') },
    ]);
    const res = await service.getUserById('u1');
    expect(res.amountSpent).toBe(9);
    expect(res.currency).toBe('USD');
    expect(res.spendingByCurrency).toEqual({ NGN: 2000, USD: 7 });
  });

  it('getUserById exposes isComplimentary, the grant details, the admin name and txn currency', async () => {
    userRepo.findByIdWithDetails.mockResolvedValue({
      ...listUser({
        id: 's',
        plan: 'yearly',
        status: 'active',
        endsAt: future,
        source: 'admin_grant',
        grantedByAdminId: 'admin-9',
        grantReason: 'press',
      }),
      paymentTransactions: [{ id: 't', amount: 5, currency: 'EUR' }],
    });
    userRepo.findById.mockResolvedValue({ id: 'admin-9', name: 'Ada Admin' });
    paymentRepo.findSuccessfulByUser.mockResolvedValue([
      { amount: 5, currency: 'EUR', createdAt: new Date('2026-03-01') },
    ]);

    const res = await service.getUserById('u1');

    expect(res.isPaidUser).toBe(true);
    expect(res.isComplimentary).toBe(true);
    expect(res.subscription).toMatchObject({
      source: 'admin_grant',
      grantedByAdminId: 'admin-9',
      grantedByAdminName: 'Ada Admin',
      grantReason: 'press',
    });
    expect(res.paymentTransactions[0].currency).toBe('EUR');
    expect(res.spendingByCurrency).toEqual({ EUR: 5 });
  });

  describe('free-plan rows are not paid', () => {
    it('an active, unexpired plan=free row is not isPaidUser / not complimentary / no activeSubscription', async () => {
      const u = await row({
        id: 's',
        plan: 'free',
        status: 'active',
        endsAt: future,
        source: 'store',
      });
      expect(u.isPaidUser).toBe(false);
      expect(u.isComplimentary).toBe(false);
      expect(u.activeSubscription).toBeNull();
    });

    it('getUserById treats a free-plan row as not paid', async () => {
      userRepo.findByIdWithDetails.mockResolvedValue(
        listUser({
          id: 's',
          plan: 'free',
          status: 'active',
          endsAt: future,
          source: 'store',
        }),
      );
      const res = await service.getUserById('u1');
      expect(res.isPaidUser).toBe(false);
      expect(res.isComplimentary).toBe(false);
    });

    it('hasActiveSubscription=true/false filters exclude plan=free from "paid"', async () => {
      userRepo.findManyWithDetails.mockResolvedValue([]);
      await service.getAllUsers({ hasActiveSubscription: true });
      expect(userRepo.count.mock.calls[0][0].subscription).toMatchObject({
        status: 'active',
        plan: { not: 'free' },
      });

      userRepo.count.mockClear();
      await service.getAllUsers({ hasActiveSubscription: false });
      const where = userRepo.count.mock.calls[0][0];
      expect(JSON.stringify(where.AND)).toContain('"plan":{"not":"free"}');
    });
  });
});
