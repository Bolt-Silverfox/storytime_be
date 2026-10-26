import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUserService } from './admin-user.service';
import { AdminFxRateService } from './admin-fx-rate.service';
import { FxRateTable } from './utils/fx-conversion.util';
import {
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_USER_REPOSITORY,
  PrismaAdminUserRepository,
} from './repositories';
import { UserFilterDto } from './dto/admin-filters.dto';

// DB-backed: needs DATABASE_URL pointing at a migrated database.
describe('AdminUserService.getAllUsers paidFirst', () => {
  let prisma: PrismaService;
  let service: AdminUserService;
  const tag = `pf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const userIds: string[] = [];

  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12));
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const past = new Date(Date.now() - 24 * 3600 * 1000);

  // createdAt order (default order is newest first): u7 > u6 > ... > u1
  const spec: Array<
    [
      string,
      { status: string; endsAt: Date | null; isDeleted?: boolean } | null,
    ]
  > = [
    ['u1', { status: 'active', endsAt: null }], // paid, oldest
    ['u2', null], // free
    ['u3', { status: 'active', endsAt: past }], // expired -> not paid
    ['u4', { status: 'active', endsAt: future }], // paid
    ['u5', { status: 'cancelled', endsAt: future }], // not paid
    ['u6', { status: 'active', endsAt: future, isDeleted: true }], // deleted sub -> not paid
    ['u7', null], // free, newest
  ];
  const id: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        AdminUserService,
        { provide: ADMIN_USER_REPOSITORY, useClass: PrismaAdminUserRepository },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: {} },
        {
          provide: AdminFxRateService,
          useValue: {
            getRateTable: jest.fn().mockResolvedValue(new FxRateTable([])),
          },
        },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(AdminUserService);

    for (const [i, [label, sub]] of spec.entries()) {
      const u = await prisma.user.create({
        data: {
          email: `${tag}-${label}@test.dev`,
          passwordHash: 'x',
          createdAt: day(i + 1),
        },
      });
      id[label] = u.id;
      userIds.push(u.id);
      if (sub) {
        await prisma.subscription.create({
          data: { userId: u.id, plan: 'monthly', ...sub },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const list = (extra: Partial<UserFilterDto>) =>
    service.getAllUsers({
      search: tag,
      page: 1,
      limit: 10,
      ...extra,
    });
  const ids = (r: { data: Array<{ id: string }> }) => r.data.map((u) => u.id);

  it('is unchanged when paidFirst is absent or false (default newest-first order)', async () => {
    const expected = ['u7', 'u6', 'u5', 'u4', 'u3', 'u2', 'u1'].map(
      (l) => id[l],
    );
    expect(ids(await list({}))).toEqual(expected);
    expect(ids(await list({ paidFirst: false }))).toEqual(expected);
  });

  it('puts active-paid users first, then the default order, with the same total', async () => {
    const res = await list({ paidFirst: true });
    // paid: u4, u1 (newest first) then the rest newest first
    expect(ids(res)).toEqual(
      ['u4', 'u1', 'u7', 'u6', 'u5', 'u3', 'u2'].map((l) => id[l]),
    );
    expect(res.meta.total).toBe(7);
    expect(res.data.slice(0, 2).every((u) => u.isPaidUser)).toBe(true);
  });

  it('honours an explicit sort inside each group', async () => {
    const res = await list({
      paidFirst: true,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    expect(ids(res)).toEqual(
      ['u1', 'u4', 'u2', 'u3', 'u5', 'u6', 'u7'].map((l) => id[l]),
    );
  });

  it('is stable and gap-free across pages, including a page that straddles the paid/free boundary', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await list({ paidFirst: true, page, limit: 2 });
      expect(res.meta).toEqual({ total: 7, page, limit: 2, totalPages: 4 });
      seen.push(...ids(res));
    }
    expect(seen).toEqual(
      ['u4', 'u1', 'u7', 'u6', 'u5', 'u3', 'u2'].map((l) => id[l]),
    );
    // limit 3: page 1 straddles the paid/free boundary (2 paid + 1 free)
    const p1 = await list({ paidFirst: true, page: 1, limit: 3 });
    expect(ids(p1)).toEqual(['u4', 'u1', 'u7'].map((l) => id[l]));
    const p2 = await list({ paidFirst: true, page: 2, limit: 3 });
    expect(ids(p2)).toEqual(['u6', 'u5', 'u3'].map((l) => id[l]));
  });

  it('combines with other filters (search narrows both groups)', async () => {
    const res = await service.getAllUsers({
      search: `${tag}-u`,
      page: 1,
      limit: 10,
      paidFirst: true,
      role: 'parent',
    });
    expect(res.meta.total).toBe(7);
    expect(ids(res).slice(0, 2)).toEqual([id.u4, id.u1]);
  });

  it('is a no-op when hasActiveSubscription is explicitly set (paid list stays paid-only)', async () => {
    const res = await list({ paidFirst: true, hasActiveSubscription: true });
    expect(ids(res)).toEqual([id.u4, id.u1]);
  });

  describe('UserFilterDto.paidFirst parsing', () => {
    it.each([
      ['true', true],
      ['false', false],
      [undefined, undefined],
    ])('query value %s -> %s', (raw, expected) => {
      const dto = plainToInstance(
        UserFilterDto,
        raw === undefined ? {} : { paidFirst: raw },
        { enableImplicitConversion: true },
      );
      expect(dto.paidFirst).toBe(expected);
    });
  });
});
