import { PasswordlessCleanupService } from './passwordless-cleanup.service';

describe('PasswordlessCleanupService', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-03-10T00:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

  it('deletes challenges that expired more than 24 hours ago', async () => {
    const repo = { deleteExpiredBefore: jest.fn().mockResolvedValue(3) };
    await new PasswordlessCleanupService(repo as never).purgeExpired();
    expect(repo.deleteExpiredBefore).toHaveBeenCalledWith(
      new Date('2026-03-09T00:00:00Z'),
    );
  });

  it('does not throw when the delete fails', async () => {
    const repo = {
      deleteExpiredBefore: jest.fn().mockRejectedValue(new Error('db')),
    };
    await expect(
      new PasswordlessCleanupService(repo as never).purgeExpired(),
    ).resolves.toBeUndefined();
  });
});
