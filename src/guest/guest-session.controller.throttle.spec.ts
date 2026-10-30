import 'reflect-metadata';
import { GuestSessionController } from './guest-session.controller';
import { throttleConfig } from '@/shared/config/throttle.config';

const meta = (key: string, handler: object): unknown =>
  Reflect.getMetadata(key, handler);

describe('GuestSessionController.createSession throttle', () => {
  const handler = GuestSessionController.prototype.createSession;
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  const resolveLimit = (): number => {
    const l = meta('THROTTLER:LIMITlong', handler);
    return typeof l === 'function'
      ? (l as (c: unknown) => number)({})
      : (l as number);
  };

  it('does not use the unmatched `default` throttler name', () => {
    expect(meta('THROTTLER:LIMITdefault', handler)).toBeUndefined();
  });

  it('targets a real throttler (`long`) with a 60s window', () => {
    const names = throttleConfig.throttlers.map((t) => t.name);
    expect(names).toContain('long');
    expect(meta('THROTTLER:TTLlong', handler)).toBe(60000);
  });

  it('is 5/min in production', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveLimit()).toBe(5);
  });

  it('applies the non-prod multiplier (x100) in development/staging', () => {
    process.env.NODE_ENV = 'staging';
    expect(resolveLimit()).toBe(500);
    process.env.NODE_ENV = 'development';
    expect(resolveLimit()).toBe(500);
  });

  it('unknown or missing NODE_ENV stays strict', () => {
    delete process.env.NODE_ENV;
    expect(resolveLimit()).toBe(5);
  });
});
