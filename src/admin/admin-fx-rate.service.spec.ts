import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminFxRateService } from './admin-fx-rate.service';
import { CreateFxRateDto } from './dto/fx-rate.dto';
import { CACHE_KEYS } from '../shared/constants/cache-keys.constants';

describe('CreateFxRateDto validation', () => {
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(CreateFxRateDto, body))).map(
      (e) => e.property,
    );

  it('accepts a valid body, effectiveFrom optional', async () => {
    expect(await errorsFor({ currency: 'NGN', rateToUsd: 0.00065 })).toEqual(
      [],
    );
    expect(
      await errorsFor({
        currency: 'NGN',
        rateToUsd: 0.00065,
        effectiveFrom: '2026-01-01T00:00:00Z',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ currency: 'ngn', rateToUsd: 1 }, 'currency'],
    [{ currency: 'NG', rateToUsd: 1 }, 'currency'],
    [{ currency: 'NGNN', rateToUsd: 1 }, 'currency'],
    [{ currency: 'N1N', rateToUsd: 1 }, 'currency'],
    [{ currency: 'NGN', rateToUsd: 0 }, 'rateToUsd'],
    [{ currency: 'NGN', rateToUsd: -1 }, 'rateToUsd'],
    [{ currency: 'NGN', rateToUsd: '0.5' }, 'rateToUsd'],
    [
      { currency: 'NGN', rateToUsd: 1, effectiveFrom: 'yesterday' },
      'effectiveFrom',
    ],
  ])('rejects %j', async (body, field) => {
    expect(await errorsFor(body)).toContain(field);
  });
});

describe('AdminFxRateService', () => {
  const repo = {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const cache = { del: jest.fn() };
  let service: AdminFxRateService;

  beforeEach(() => {
    jest.resetAllMocks();
    cache.del.mockResolvedValue(undefined);
    service = new AdminFxRateService(repo as never, cache as never);
  });

  const row = (over = {}) => ({
    id: 'r1',
    currency: 'NGN',
    rateToUsd: { toNumber: () => 0.00065 },
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    source: 'manual',
    createdByAdminId: 'a1',
    createdAt: new Date('2026-01-02T00:00:00Z'),
    ...over,
  });

  it('list maps decimals to numbers and filters by upper-cased currency', async () => {
    repo.list.mockResolvedValue([row()]);
    const out = await service.list('ngn');
    expect(repo.list).toHaveBeenCalledWith('NGN');
    expect(out[0].rateToUsd).toBe(0.00065);
  });

  it('create stores the rate, defaulting effectiveFrom to now, and invalidates dashboard cache', async () => {
    repo.create.mockResolvedValue(row());
    const before = Date.now();
    await service.create({ currency: 'NGN', rateToUsd: 0.00065 }, 'a1');
    const arg = repo.create.mock.calls[0][0];
    expect(arg).toMatchObject({
      currency: 'NGN',
      rateToUsd: 0.00065,
      createdByAdminId: 'a1',
      source: 'manual',
    });
    expect(arg.effectiveFrom.getTime()).toBeGreaterThanOrEqual(before);
    expect(cache.del).toHaveBeenCalledWith(CACHE_KEYS.DASHBOARD_STATS);
  });

  it('rejects USD (implicit rate 1)', async () => {
    await expect(
      service.create({ currency: 'USD', rateToUsd: 1 }, 'a1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects effectiveFrom more than 1 day in the future, allows within 1 day', async () => {
    const far = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await expect(
      service.create(
        { currency: 'NGN', rateToUsd: 1, effectiveFrom: far },
        'a1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    repo.create.mockResolvedValue(row());
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    await expect(
      service.create(
        { currency: 'NGN', rateToUsd: 1, effectiveFrom: soon },
        'a1',
      ),
    ).resolves.toBeDefined();
  });

  it('rejects non-positive / non-finite rates at the service level too', async () => {
    for (const rateToUsd of [0, -2, NaN, Infinity]) {
      await expect(
        service.create({ currency: 'NGN', rateToUsd }, 'a1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('maps a unique violation (same currency + effectiveFrom) to 409', async () => {
    repo.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create({ currency: 'NGN', rateToUsd: 1 }, 'a1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('delete removes the rate and invalidates cache; 404 when unknown', async () => {
    repo.findById.mockResolvedValueOnce(row());
    repo.delete.mockResolvedValue(undefined);
    const removed = await service.remove('r1');
    expect(removed.id).toBe('r1');
    expect(repo.delete).toHaveBeenCalledWith('r1');
    expect(cache.del).toHaveBeenCalledWith(CACHE_KEYS.DASHBOARD_STATS);

    repo.findById.mockResolvedValueOnce(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getRateTable loads all rates once and builds a table', async () => {
    repo.list.mockResolvedValue([row()]);
    const table = await service.getRateTable();
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(table.resolve('NGN', new Date('2026-02-01'))?.rate).toBe(0.00065);
  });
});
