import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import {
  ReadingAnalyticsRangeDto,
  resolveReadingAnalyticsWindow,
} from './reading-analytics.dto';

describe('ReadingAnalyticsRangeDto', () => {
  it.each([7, 30, 90, 120, 365])('accepts range=%d', async (range) => {
    const dto = plainToInstance(ReadingAnalyticsRangeDto, { range });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an out-of-set range value', async () => {
    const dto = plainToInstance(ReadingAnalyticsRangeDto, { range: 45 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('range');
  });

  it('accepts a valid custom startDate/endDate pair', async () => {
    const dto = plainToInstance(ReadingAnalyticsRangeDto, {
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-ISO-date startDate', async () => {
    const dto = plainToInstance(ReadingAnalyticsRangeDto, {
      startDate: 'not-a-date',
      endDate: '2026-02-01',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'startDate')).toBe(true);
  });
});

describe('resolveReadingAnalyticsWindow', () => {
  it('falls back to a day-count window when no custom dates are given', () => {
    const { start, end } = resolveReadingAnalyticsWindow({ range: 30 });
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(30, 0);
  });

  it('uses the explicit custom window when both startDate and endDate are given, taking precedence over range', () => {
    const { start, end } = resolveReadingAnalyticsWindow({
      range: 7,
      startDate: '2026-01-01',
      endDate: '2026-03-01',
    });
    expect(start).toEqual(new Date('2026-01-01'));
    expect(end).toEqual(new Date('2026-03-01T23:59:59.999Z'));
  });

  it('treats a date-only endDate as inclusive of the whole day, not its midnight start', () => {
    const { end } = resolveReadingAnalyticsWindow({
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    });
    expect(end.toISOString()).toBe('2026-01-02T23:59:59.999Z');
  });

  it('uses a full endDate timestamp as-is, without widening it to end-of-day', () => {
    const { end } = resolveReadingAnalyticsWindow({
      startDate: '2026-01-01',
      endDate: '2026-01-02T10:00:00.000Z',
    });
    expect(end.toISOString()).toBe('2026-01-02T10:00:00.000Z');
  });

  it('throws BadRequestException when the custom window exceeds 365 days', () => {
    expect(() =>
      resolveReadingAnalyticsWindow({
        startDate: '1970-01-01',
        endDate: '2100-01-01',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts a custom window well within the 365-day max', () => {
    expect(() =>
      resolveReadingAnalyticsWindow({
        startDate: '2026-01-01',
        endDate: '2026-12-01',
      }),
    ).not.toThrow();
  });

  it('throws BadRequestException when startDate is not before endDate', () => {
    expect(() =>
      resolveReadingAnalyticsWindow({
        range: 30,
        startDate: '2026-02-01',
        endDate: '2026-01-01',
      }),
    ).toThrow(BadRequestException);
  });

  it('treats a date-only startDate/endDate on the same calendar day as a valid single-day window', () => {
    // Both are date-only, so endDate widens to end-of-day (23:59:59.999Z),
    // making this a valid (if narrow) window rather than a zero-width one.
    const { start, end } = resolveReadingAnalyticsWindow({
      range: 30,
      startDate: '2026-01-01',
      endDate: '2026-01-01',
    });
    expect(start).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(end).toEqual(new Date('2026-01-01T23:59:59.999Z'));
  });

  it('throws BadRequestException when startDate equals endDate as identical full timestamps', () => {
    expect(() =>
      resolveReadingAnalyticsWindow({
        range: 30,
        startDate: '2026-01-01T10:00:00.000Z',
        endDate: '2026-01-01T10:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('ignores a partial custom range (only startDate given) and falls back to range', () => {
    const { start, end } = resolveReadingAnalyticsWindow({
      range: 7,
      startDate: '2026-01-01',
    });
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 0);
  });
});
