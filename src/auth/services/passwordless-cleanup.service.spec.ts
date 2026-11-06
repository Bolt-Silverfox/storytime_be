import { PasswordlessCleanupService } from './passwordless-cleanup.service';

const build = (enabled: boolean, deletes: Array<number | Error>) => {
  const deleteExpiredBefore = jest.fn();
  for (const d of deletes) {
    if (d instanceof Error) deleteExpiredBefore.mockRejectedValueOnce(d);
    else deleteExpiredBefore.mockResolvedValueOnce(d);
  }
  const config = { get: () => enabled };
  return {
    deleteExpiredBefore,
    service: new PasswordlessCleanupService(
      { deleteExpiredBefore } as never,
      config as never,
    ),
  };
};

describe('PasswordlessCleanupService', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-03-10T00:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

  it('deletes challenges that expired more than 24 hours ago', async () => {
    const { service, deleteExpiredBefore } = build(true, [3]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).toHaveBeenCalledWith(
      new Date('2026-03-09T00:00:00Z'),
      1000,
    );
  });

  it('deletes in bounded batches until one comes back short', async () => {
    const { service, deleteExpiredBefore } = build(true, [1000, 1000, 5]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).toHaveBeenCalledTimes(3);
  });

  it('stops after a maximum number of batches', async () => {
    const { service, deleteExpiredBefore } = build(
      true,
      Array.from({ length: 50 }, () => 1000),
    );
    await service.purgeExpired();
    expect(deleteExpiredBefore.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('does nothing while the feature flag is off', async () => {
    const { service, deleteExpiredBefore } = build(false, [3]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).not.toHaveBeenCalled();
  });

  it('does not throw when the delete fails', async () => {
    const { service } = build(true, [new Error('db')]);
    await expect(service.purgeExpired()).resolves.toBeUndefined();
  });
});
