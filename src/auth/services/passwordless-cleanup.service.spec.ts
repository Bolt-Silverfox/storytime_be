import { PasswordlessCleanupService } from './passwordless-cleanup.service';

const build = (deletes: Array<number | Error>) => {
  const deleteExpiredBefore = jest.fn();
  for (const d of deletes) {
    if (d instanceof Error) deleteExpiredBefore.mockRejectedValueOnce(d);
    else deleteExpiredBefore.mockResolvedValueOnce(d);
  }
  return {
    deleteExpiredBefore,
    service: new PasswordlessCleanupService({ deleteExpiredBefore } as never),
  };
};

describe('PasswordlessCleanupService', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-03-10T00:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

  it('deletes challenges that expired more than 24 hours ago', async () => {
    const { service, deleteExpiredBefore } = build([3]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).toHaveBeenCalledWith(
      new Date('2026-03-09T00:00:00Z'),
      1000,
    );
  });

  it('deletes in bounded batches until one comes back short', async () => {
    const { service, deleteExpiredBefore } = build([1000, 1000, 5]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).toHaveBeenCalledTimes(3);
  });

  it('stops after a maximum number of batches', async () => {
    const { service, deleteExpiredBefore } = build(
      Array.from({ length: 50 }, () => 1000),
    );
    await service.purgeExpired();
    expect(deleteExpiredBefore.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('purges rows holding emails without consulting the feature flag', async () => {
    const { service, deleteExpiredBefore } = build([3]);
    await service.purgeExpired();
    expect(deleteExpiredBefore).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the delete fails', async () => {
    const { service } = build([new Error('db')]);
    await expect(service.purgeExpired()).resolves.toBeUndefined();
  });
});
