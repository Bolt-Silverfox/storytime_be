import { AvatarService } from './avatar.service';
import { HASH_SENTINELS } from '@/shared/testing/authz-harness';

describe('AvatarService user responses', () => {
  const row = {
    id: 'u1',
    email: 'u@example.com',
    avatarId: null,
    avatar: { id: 'a1' },
    ...HASH_SENTINELS,
  };
  const repo = {
    findUserById: jest.fn().mockResolvedValue(row),
    findUserWithAvatar: jest.fn().mockResolvedValue(row),
    findByIdNotDeleted: jest.fn().mockResolvedValue({ id: 'a1' }),
    upsertByName: jest.fn().mockResolvedValue({ id: 'a1' }),
    updateUserAvatar: jest.fn().mockResolvedValue(row),
  };
  const upload = {
    uploadImage: jest
      .fn()
      .mockResolvedValue({ secure_url: 'https://x/y.png', public_id: 'p' }),
  };
  const service = new AvatarService(repo as never, upload as never);

  it('assignAvatarToUser never returns passwordHash or pinHash', async () => {
    const result = await service.assignAvatarToUser('u1', 'a1');
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|pinHash/);
    expect(result).toMatchObject({ id: 'u1', email: 'u@example.com' });
  });

  it('uploadAndAssignUserAvatar never returns passwordHash or pinHash', async () => {
    const result = await service.uploadAndAssignUserAvatar('u1', {} as never);
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|pinHash/);
    expect(result).toMatchObject({ id: 'u1' });
  });
});
