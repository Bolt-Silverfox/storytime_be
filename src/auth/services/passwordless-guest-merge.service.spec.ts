import { PasswordlessGuestMergeService } from './passwordless-guest-merge.service';
import { InMemoryRedis } from '@/shared/testing/passwordless-fakes';

const GUEST = '0b1f6b4e-7c1a-4a39-9a55-2f1f6f0f7a11';

function build(history: Record<string, unknown> | null) {
  const redis = new InMemoryRedis();
  const guestSessions = {
    getGuestReadingHistory: jest.fn().mockResolvedValue(history),
    getStoryDetailsByIds: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(ids.filter((i) => i !== 'gone').map((id) => ({ id }))),
      ),
    upsertUserStoryProgress: jest.fn().mockResolvedValue(undefined),
    deleteGuestSession: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PasswordlessGuestMergeService(
    guestSessions as never,
    redis as never,
  );
  return { service, guestSessions, redis };
}

describe('PasswordlessGuestMergeService', () => {
  it('copies already-read story ids to a new user as zero-progress rows', async () => {
    const { service, guestSessions } = build({
      s1: { progress: 80, completed: true },
      s2: { progress: 0 },
    });
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledTimes(2);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledWith(
      'u1',
      's1',
      0,
      false,
    );
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledWith(
      'u1',
      's2',
      0,
      false,
    );
  });

  it('claims a guest session only once', async () => {
    const { service, guestSessions } = build({ s1: {} });
    await service.carryOver('u1', GUEST, true);
    await service.carryOver('u2', GUEST, true);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledTimes(1);
  });

  it('ignores a header that is not a UUID without touching redis or the session', async () => {
    const { service, guestSessions } = build({ s1: {} });
    await service.carryOver('u1', 'not-a-uuid', true);
    await service.carryOver('u1', "1' OR '1'='1", true);
    expect(guestSessions.getGuestReadingHistory).not.toHaveBeenCalled();
  });

  it('does not carry over for an existing account', async () => {
    const { service, guestSessions } = build({ s1: {} });
    await service.carryOver('u1', GUEST, false);
    expect(guestSessions.getGuestReadingHistory).not.toHaveBeenCalled();
  });

  it('does nothing when the guest session is unknown', async () => {
    const { service, guestSessions } = build(null);
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.upsertUserStoryProgress).not.toHaveBeenCalled();
  });

  it('never carries more than the guest story limit even if the session lists more', async () => {
    const { service, guestSessions } = build({
      a: {},
      b: {},
      c: {},
      d: {},
      e: {},
    });
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledTimes(3);
  });

  it('skips stories that no longer exist', async () => {
    const { service, guestSessions } = build({ gone: {}, s1: {} });
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledTimes(1);
    expect(guestSessions.upsertUserStoryProgress).toHaveBeenCalledWith(
      'u1',
      's1',
      0,
      false,
    );
  });

  it('retires the guest session after carrying it over so it cannot be claimed again', async () => {
    const { service, guestSessions } = build({ s1: {} });
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.deleteGuestSession).toHaveBeenCalledWith(GUEST);
  });

  it('still retires the session when nothing is left to copy', async () => {
    const { service, guestSessions } = build({});
    await service.carryOver('u1', GUEST, true);
    expect(guestSessions.deleteGuestSession).toHaveBeenCalledWith(GUEST);
  });
});
