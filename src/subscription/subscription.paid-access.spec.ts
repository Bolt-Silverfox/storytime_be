import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionService } from './subscription.service';
import { hasPaidAccess } from './subscription.constants';
import { CacheMetricsService } from '@/shared/services/cache-metrics.service';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { mapParentProfile } from '../user/utils/parent-profile.mapper';
import {
  SUBSCRIPTION_REPOSITORY,
  PAYMENT_TRANSACTION_REPOSITORY,
  USER_REPOSITORY,
} from './repositories';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('hasPaidAccess', () => {
  it.each([
    [
      'active monthly',
      { status: 'active', plan: 'monthly', endsAt: future },
      true,
    ],
    [
      'active yearly, no end',
      { status: 'active', plan: 'yearly', endsAt: null },
      true,
    ],
    [
      'active FREE plan',
      { status: 'active', plan: 'free', endsAt: future },
      false,
    ],
    [
      'active FREE plan, no end',
      { status: 'active', plan: 'free', endsAt: null },
      false,
    ],
    [
      'expired monthly',
      { status: 'active', plan: 'monthly', endsAt: past },
      false,
    ],
    [
      'cancelled monthly',
      { status: 'cancelled', plan: 'monthly', endsAt: future },
      false,
    ],
    ['null', null, false],
  ])('%s -> %s', (_n, sub, expected) => {
    expect(hasPaidAccess(sub as never)).toBe(expected);
  });
});

describe('SubscriptionService.isPremiumUser with a free-plan row', () => {
  const userRepo = { findByIdWithSubscriptionStatus: jest.fn() };
  let service: SubscriptionService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: SUBSCRIPTION_REPOSITORY, useValue: {} },
        { provide: PAYMENT_TRANSACTION_REPOSITORY, useValue: {} },
        { provide: USER_REPOSITORY, useValue: userRepo },
        {
          provide: CacheMetricsService,
          useValue: {
            getOrSet: jest.fn((_k: string, fn: () => Promise<boolean>) => fn()),
            del: jest.fn(),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(SubscriptionService);
  });

  const user = (subscription: unknown, extra: object = {}) => ({
    role: 'parent',
    premiumAccessUntil: null,
    subscription,
    ...extra,
  });

  it('is NOT premium for an active, unexpired free-plan row', async () => {
    userRepo.findByIdWithSubscriptionStatus.mockResolvedValue(
      user({ status: 'active', plan: 'free', endsAt: future }),
    );
    await expect(service.isPremiumUser('u1')).resolves.toBe(false);
  });

  it('is premium for an active paid plan (unchanged)', async () => {
    userRepo.findByIdWithSubscriptionStatus.mockResolvedValue(
      user({ status: 'active', plan: 'monthly', endsAt: future }),
    );
    await expect(service.isPremiumUser('u1')).resolves.toBe(true);
  });

  it('is premium for an admin-granted paid plan (unchanged)', async () => {
    userRepo.findByIdWithSubscriptionStatus.mockResolvedValue(
      user({ status: 'active', plan: 'yearly', endsAt: future }),
    );
    await expect(service.isPremiumUser('u1')).resolves.toBe(true);
  });

  it('coupon premium and admin role still win over a free row (unchanged)', async () => {
    userRepo.findByIdWithSubscriptionStatus.mockResolvedValue(
      user(
        { status: 'active', plan: 'free', endsAt: future },
        { premiumAccessUntil: future },
      ),
    );
    await expect(service.isPremiumUser('u1')).resolves.toBe(true);
    userRepo.findByIdWithSubscriptionStatus.mockResolvedValue(
      user(
        { status: 'active', plan: 'free', endsAt: future },
        { role: 'admin' },
      ),
    );
    await expect(service.isPremiumUser('u1')).resolves.toBe(true);
  });

  it('the repository query selects the plan (needed to tell free from paid)', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repo = new PrismaUserRepository({ user: { findUnique } } as never);
    await repo.findByIdWithSubscriptionStatus('u1');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          subscription: { select: expect.objectContaining({ plan: true }) },
        }),
      }),
    );
  });
});

describe('mapParentProfile subscriptionStatus', () => {
  const base = {
    id: 'u',
    email: 'e',
    role: 'parent',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sub = (plan: string, endsAt: Date | null = future) =>
    ({ status: 'active', plan, endsAt }) as never;

  it('reports free for an active free-plan row', () => {
    expect(
      mapParentProfile({ ...base, subscription: sub('free') })
        ?.subscriptionStatus,
    ).toBe('free');
  });
  it('reports active for an active paid plan', () => {
    expect(
      mapParentProfile({ ...base, subscription: sub('monthly') })
        ?.subscriptionStatus,
    ).toBe('active');
  });
});
