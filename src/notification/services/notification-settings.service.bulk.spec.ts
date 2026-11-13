import { NotFoundException } from '@nestjs/common';
import { NotificationPreference } from '@prisma/client';
import { NotificationSettingsService } from './notification-settings.service';

const row = (
  id: string,
  owner: { userId: string | null; kidId: string | null },
  extra: Partial<NotificationPreference> = {},
): NotificationPreference => ({
  id,
  type: 'push',
  category: 'NEW_STORY',
  enabled: true,
  isDeleted: false,
  deletedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...owner,
  ...extra,
});

describe('NotificationSettingsService.bulkUpdate', () => {
  const rows = [
    row('own', { userId: 'alice', kidId: null }),
    row('kid-only', { userId: null, kidId: 'alice-kid' }),
    row('bobs', { userId: 'bob', kidId: null }),
    row('gone', { userId: 'alice', kidId: null }, { isDeleted: true }),
  ];
  const findMany = jest.fn();
  const bulkUpdateInTx = jest.fn();
  const service = new NotificationSettingsService({
    findActiveNotificationPreferencesByIds: findMany,
    bulkUpdateEnabledInTransaction: bulkUpdateInTx,
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockImplementation((ids: string[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id) && !r.isDeleted)),
    );
    bulkUpdateInTx.mockImplementation((updates: { id: string }[]) =>
      Promise.resolve(rows.filter((r) => updates.some((u) => u.id === r.id))),
    );
  });

  it('updates a kid-only preference that has no userId', async () => {
    const result = await service.bulkUpdate([
      { id: 'kid-only', enabled: false },
    ]);
    expect(result.map((p) => p.id)).toEqual(['kid-only']);
    expect(bulkUpdateInTx).toHaveBeenCalledWith([
      { id: 'kid-only', enabled: false },
    ]);
  });

  it("updates another user's preference once the caller is authorised", async () => {
    const result = await service.bulkUpdate([
      { id: 'bobs', enabled: false },
      { id: 'own', enabled: false },
    ]);
    expect(result.map((p) => p.id).sort()).toEqual(['bobs', 'own']);
  });

  it('writes nothing when any id is missing or soft-deleted', async () => {
    await expect(
      service.bulkUpdate([
        { id: 'own', enabled: false },
        { id: 'gone', enabled: false },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bulkUpdateInTx).not.toHaveBeenCalled();
  });
});
