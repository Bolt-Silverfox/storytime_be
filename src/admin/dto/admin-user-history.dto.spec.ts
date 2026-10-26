import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import {
  UserActivityQueryDto,
  UserReadingQueryDto,
  resolveActivityWindow,
  resolveReadingWindow,
} from './admin-user-history.dto';

const props = async (cls: new () => object, plain: object) =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('UserActivityQueryDto', () => {
  it('defaults to page 1, limit 20', () => {
    const dto = plainToInstance(UserActivityQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('accepts a full valid query', async () => {
    expect(
      await props(UserActivityQueryDto, {
        page: '2',
        limit: '100',
        action: 'USER_LOGIN',
        from: '2026-01-01',
        to: '2026-02-01T10:00:00Z',
        kidId: 'kid-1',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ page: 0 }, 'page'],
    [{ from: '2026-02-30' }, 'from'],
    [{ to: '2026-13-01' }, 'to'],
    [{ from: 'yesterday' }, 'from'],
    [{ action: 'x'.repeat(101) }, 'action'],
  ])('rejects %j', async (plain, property) => {
    expect(await props(UserActivityQueryDto, plain)).toContain(property);
  });

  describe('resolveActivityWindow', () => {
    it('returns undefined bounds when nothing is given', () => {
      expect(resolveActivityWindow({})).toEqual({
        from: undefined,
        to: undefined,
      });
    });
    it('makes a date-only `to` inclusive of the whole UTC day', () => {
      const { from, to } = resolveActivityWindow({
        from: '2026-01-01',
        to: '2026-01-01',
      });
      expect(from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(to?.toISOString()).toBe('2026-01-01T23:59:59.999Z');
    });
    it('rejects from > to with 400', () => {
      expect(() =>
        resolveActivityWindow({ from: '2026-02-02', to: '2026-02-01' }),
      ).toThrow(BadRequestException);
    });
  });
});

describe('UserReadingQueryDto', () => {
  it('defaults to range=all, page 1, limit 20', () => {
    const dto = plainToInstance(UserReadingQueryDto, {});
    expect(dto.range).toBe('all');
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it.each(['7', '30', '90', '120', '365', 'all'])(
    'accepts range=%s',
    async (range) => {
      expect(await props(UserReadingQueryDto, { range })).toEqual([]);
    },
  );

  it('coerces numeric range strings to numbers and keeps "all"', () => {
    expect(plainToInstance(UserReadingQueryDto, { range: '30' }).range).toBe(
      30,
    );
    expect(plainToInstance(UserReadingQueryDto, { range: 'all' }).range).toBe(
      'all',
    );
  });

  it.each([
    [{ range: '45' }, 'range'],
    [{ range: 'forever' }, 'range'],
    [{ startDate: '2026-02-30' }, 'startDate'],
    [{ endDate: 'nope' }, 'endDate'],
    [{ limit: 101 }, 'limit'],
  ])('rejects %j', async (plain, property) => {
    expect(await props(UserReadingQueryDto, plain)).toContain(property);
  });

  describe('resolveReadingWindow', () => {
    const now = new Date('2026-06-30T12:00:00.000Z');
    it('range=all has no bounds', () => {
      expect(resolveReadingWindow({ range: 'all' }, now)).toEqual({
        start: undefined,
        end: undefined,
      });
    });
    it('numeric range is now minus N days', () => {
      const { start, end } = resolveReadingWindow({ range: 7 }, now);
      expect(start?.toISOString()).toBe('2026-06-23T12:00:00.000Z');
      expect(end).toBeUndefined();
    });
    it('explicit startDate/endDate take precedence over range, date-only end inclusive', () => {
      const { start, end } = resolveReadingWindow(
        { range: 7, startDate: '2026-01-01', endDate: '2026-01-31' },
        now,
      );
      expect(start?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(end?.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    });
    it('rejects startDate after endDate with 400', () => {
      expect(() =>
        resolveReadingWindow(
          { range: 'all', startDate: '2026-02-02', endDate: '2026-02-01' },
          now,
        ),
      ).toThrow(BadRequestException);
    });
  });
});
