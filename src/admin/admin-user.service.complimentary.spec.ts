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

  it('reports spend per currency instead of silently mixing them', async () => {
    const u = await row(null, [
      { amount: 4.99, currency: 'USD' },
      { amount: 47.99, currency: 'USD' },
      { amount: 1000, currency: 'NGN' },
    ] as never);
    expect(u.spendingByCurrency).toEqual({ USD: 52.98, NGN: 1000 });
    // headline figure stays single-currency (largest bucket) and is labelled
    expect(u.currency).toBe('NGN');
    expect(u.amountSpent).toBe(1000);
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
});
