import { Test, TestingModule } from '@nestjs/testing';
import { AdminUserService } from './admin-user.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
} from './repositories';

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
    findLastActivityByUserIds: jest.fn(),
  };
  const paymentRepo = { findSuccessfulByUser: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    userRepo.count.mockResolvedValue(1);
    userRepo.findLastActivityByUserIds.mockResolvedValue(new Map());
    paymentRepo.findSuccessfulByUser.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        { provide: ADMIN_USER_REPOSITORY, useValue: userRepo },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: paymentRepo },
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

  it('reports spend per currency; amountSpent/currency are null when currencies are mixed', async () => {
    const u = await row(null, [
      { amount: 4.99, currency: 'USD' },
      { amount: 47.99, currency: 'USD' },
      { amount: 1000, currency: 'NGN' },
    ] as never);
    expect(u.spendingByCurrency).toEqual({ USD: 52.98, NGN: 1000 });
    expect(u.amountSpent).toBeNull();
    expect(u.currency).toBeNull();
  });

  it('single currency keeps a numeric amountSpent and its currency', async () => {
    const u = await row(null, [
      { amount: 4.99, currency: 'USD' },
      { amount: 47.99, currency: 'usd' },
    ] as never);
    expect(u.amountSpent).toBe(52.98);
    expect(u.currency).toBe('USD');
    expect(u.spendingByCurrency).toEqual({ USD: 52.98 });
  });

  it('no transactions -> 0 and no currency', async () => {
    const u = await row(null, []);
    expect(u.amountSpent).toBe(0);
    expect(u.currency).toBeNull();
    expect(u.spendingByCurrency).toEqual({});
  });

  it('transactions with a missing currency are grouped as UNKNOWN (and mix with real ones)', async () => {
    const only = await row(null, [{ amount: 3, currency: null }] as never);
    expect(only.spendingByCurrency).toEqual({ UNKNOWN: 3 });
    expect(only.amountSpent).toBe(3);
    expect(only.currency).toBeNull();

    const mixed = await row(null, [
      { amount: 3, currency: null },
      { amount: 5, currency: 'USD' },
    ] as never);
    expect(mixed.spendingByCurrency).toEqual({ UNKNOWN: 3, USD: 5 });
    expect(mixed.amountSpent).toBeNull();
  });

  it('getUserById applies the same single-vs-mixed rule', async () => {
    userRepo.findByIdWithDetails.mockResolvedValue(listUser(null));
    paymentRepo.findSuccessfulByUser.mockResolvedValue([
      { amount: 5, currency: 'EUR' },
      { amount: 7, currency: 'USD' },
    ]);
    const mixed = await service.getUserById('u1');
    expect(mixed.amountSpent).toBeNull();
    expect(mixed.currency).toBeNull();
    expect(mixed.spendingByCurrency).toEqual({ EUR: 5, USD: 7 });

    paymentRepo.findSuccessfulByUser.mockResolvedValue([
      { amount: 5, currency: 'EUR' },
    ]);
    const single = await service.getUserById('u1');
    expect(single.amountSpent).toBe(5);
    expect(single.currency).toBe('EUR');
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
      { amount: 5, currency: 'EUR' },
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
