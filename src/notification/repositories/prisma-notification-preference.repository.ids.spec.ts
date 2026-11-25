import { PrismaNotificationPreferenceRepository } from './prisma-notification-preference.repository';

describe('PrismaNotificationPreferenceRepository lookups by id', () => {
  const findMany = jest.fn();
  const repo = new PrismaNotificationPreferenceRepository({
    notificationPreference: { findMany },
  } as never);

  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('scopes the user-scoped lookup to the user and skips soft-deleted rows', async () => {
    await repo.findManyNotificationPreferencesByIds(['a'], 'u1');
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] }, userId: 'u1', isDeleted: false },
    });
  });

  it('does not filter by user in the unscoped lookup but skips soft-deleted rows', async () => {
    await repo.findActiveNotificationPreferencesByIds(['a']);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] }, isDeleted: false },
    });
  });
});
