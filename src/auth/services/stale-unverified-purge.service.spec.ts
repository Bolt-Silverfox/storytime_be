import { Logger } from '@nestjs/common';
import { StaleUnverifiedPurgeService } from './stale-unverified-purge.service';

const makeService = (mode?: string) => {
  const repo = {
    countEligible: jest.fn().mockResolvedValue(7),
    findEligibleIds: jest.fn(),
    deleteEligibleByIds: jest.fn(),
  };
  const service = new StaleUnverifiedPurgeService(
    repo as never,
    {
      get: (k: string) => (k === 'STALE_UNVERIFIED_PURGE' ? mode : undefined),
    } as never,
  );
  return { service, repo };
};

describe('StaleUnverifiedPurgeService', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, 'off', 'bogus'])(
    'does nothing when the mode is %s',
    async (mode) => {
      const { service, repo } = makeService(mode);
      await service.purge();
      expect(repo.countEligible).not.toHaveBeenCalled();
      expect(repo.findEligibleIds).not.toHaveBeenCalled();
      expect(repo.deleteEligibleByIds).not.toHaveBeenCalled();
    },
  );

  it('dry-run only counts and logs the number without deleting', async () => {
    const { service, repo } = makeService('dry-run');
    await service.purge();
    expect(repo.countEligible).toHaveBeenCalledTimes(1);
    expect(repo.deleteEligibleByIds).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('7'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
  });

  it('uses a cutoff 30 days in the past', async () => {
    const { service, repo } = makeService('dry-run');
    const before = Date.now();
    await service.purge();
    const cutoff = repo.countEligible.mock.calls[0][0] as Date;
    const age = before - cutoff.getTime();
    expect(age).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 1000);
    expect(age).toBeLessThan(30 * 24 * 60 * 60 * 1000 + 60_000);
  });

  it('on deletes batch by batch until a short batch and logs only counts', async () => {
    const { service, repo } = makeService('on');
    const full = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    repo.findEligibleIds
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce(['x@example.com-id']);
    repo.deleteEligibleByIds
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(1);

    await service.purge();

    expect(repo.findEligibleIds).toHaveBeenNthCalledWith(
      1,
      expect.any(Date),
      500,
    );
    expect(repo.deleteEligibleByIds).toHaveBeenCalledTimes(2);
    expect(repo.deleteEligibleByIds.mock.calls[0][0]).toHaveLength(500);
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('501');
    expect(logged).not.toContain('@');
    expect(logged).not.toContain('id-0');
  });

  it('on stops after the batch cap even if rows remain', async () => {
    const { service, repo } = makeService('on');
    const full = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    repo.findEligibleIds.mockResolvedValue(full);
    repo.deleteEligibleByIds.mockResolvedValue(500);

    await service.purge();

    expect(repo.deleteEligibleByIds).toHaveBeenCalledTimes(20);
  });

  it('swallows and logs a repository failure without leaking details', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, repo } = makeService('on');
    repo.findEligibleIds.mockRejectedValue(new Error('boom user@example.com'));

    await expect(service.purge()).resolves.toBeUndefined();

    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('failed');
    expect(logged).not.toContain('user@example.com');
  });
});
