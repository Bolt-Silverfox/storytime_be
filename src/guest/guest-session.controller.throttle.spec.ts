import 'reflect-metadata';
import { GuestSessionController } from './guest-session.controller';
import { throttleConfig } from '@/shared/config/throttle.config';

const meta = (key: string, handler: object): unknown =>
  Reflect.getMetadata(key, handler);

describe('GuestSessionController.createSession throttle', () => {
  const handler = GuestSessionController.prototype.createSession;

  it('does not use the unmatched `default` throttler name', () => {
    expect(meta('THROTTLER:LIMITdefault', handler)).toBeUndefined();
  });

  it('applies the intended 5/min limit to a throttler that really exists', () => {
    const names = throttleConfig.throttlers.map((t) => t.name);
    const hit = names.filter((n) => meta(`THROTTLER:LIMIT${n}`, handler) === 5);
    expect(hit).toEqual(['long']);
    expect(meta('THROTTLER:TTLlong', handler)).toBe(60000);
  });
});
