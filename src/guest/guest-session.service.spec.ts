import { ConfigService } from '@nestjs/config';
import { GuestSessionService } from './guest-session.service';
import type { IGuestRepository } from './repositories/guest.repository.interface';

/**
 * Regression test for the guest-session keyv fallback.
 *
 * Previously, when Redis was unreachable the constructor's `error` handler
 * swapped `this.keyv` to a *fresh empty* in-memory store, so the value written
 * by `set` was lost and the immediate read-back returned undefined — surfacing
 * as a 500 "Failed to create guest session". The in-memory fallback must work.
 */
describe('GuestSessionService — in-memory fallback', () => {
  // Point at an unreachable Redis so the service must use the in-memory store.
  const configService = {
    get: jest.fn().mockReturnValue('redis://127.0.0.1:6390'),
  } as unknown as ConfigService;
  const guestRepository = {} as unknown as IGuestRepository;

  it('createGuestSession stores and reads back without Redis', async () => {
    const service = new GuestSessionService(configService, guestRepository);
    // Intentionally do NOT call onModuleInit -> the service stays on its
    // default in-memory store (the fallback path).

    const session = await service.createGuestSession();
    expect(session.sessionId).toBeTruthy();

    const fetched = await service.getGuestSession(session.sessionId);
    expect(fetched).not.toBeNull();
    expect(fetched?.sessionId).toBe(session.sessionId);
  });
});
