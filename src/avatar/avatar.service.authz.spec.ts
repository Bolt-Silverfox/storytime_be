import { PayloadTooLargeException } from '@nestjs/common';
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
    create: jest.fn().mockResolvedValue({ id: 'a2' }),
    findKidWithAvatar: jest
      .fn()
      .mockResolvedValue({ id: 'k1', avatarId: null }),
  };
  const upload = {
    deleteImage: jest.fn().mockResolvedValue(undefined),
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

  it('uploadAndAssignUserAvatar passes the upload owner to the upload service', async () => {
    upload.uploadImage.mockClear();
    const owner = { userId: 'u1', exempt: false };
    await service.uploadAndAssignUserAvatar('u1', {} as never, owner);
    expect(upload.uploadImage).toHaveBeenCalledWith({}, 'avatars', owner);
  });

  it('createAvatar passes the upload owner to the upload service', async () => {
    upload.uploadImage.mockClear();
    const owner = { userId: 'u1', exempt: false };
    await service.createAvatar(
      { name: 'x' },
      {} as never,
      false,
      undefined,
      owner,
    );
    expect(upload.uploadImage).toHaveBeenCalledWith({}, 'avatars', owner);
  });

  describe('the upload cap answers 413, not a generic 400', () => {
    const quota = () =>
      new PayloadTooLargeException({ error: 'UPLOAD_QUOTA_EXCEEDED' });

    it.each([
      [
        'user avatar',
        () => service.uploadAndAssignUserAvatar('u1', {} as never),
      ],
      ['kid avatar', () => service.uploadAndAssignKidAvatar('k1', {} as never)],
      [
        'create avatar',
        () => service.createAvatar({ name: 'x' }, {} as never, false),
      ],
    ])('passes it through for a %s', async (_label, run) => {
      upload.uploadImage.mockRejectedValueOnce(quota());
      await expect(run()).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe('createAvatar when saving the avatar row fails', () => {
    const file = { size: 1 } as never;

    beforeEach(() => {
      upload.deleteImage.mockClear();
      upload.uploadImage.mockResolvedValue({
        secure_url: 'https://x/y.png',
        public_id: 'new-asset',
      });
    });

    it('deletes the uploaded asset and rethrows the original error', async () => {
      const failure = new Error('db down');
      repo.create.mockRejectedValueOnce(failure);
      await expect(
        service.createAvatar({ name: 'x' }, file, false, undefined, {
          userId: 'u1',
          exempt: false,
        }),
      ).rejects.toBe(failure);
      expect(upload.deleteImage).toHaveBeenCalledWith('new-asset');
    });

    it('still rethrows the original error when the cleanup fails too', async () => {
      const failure = new Error('db down');
      repo.create.mockRejectedValueOnce(failure);
      upload.deleteImage.mockRejectedValueOnce(new Error('cdn down'));
      await expect(
        service.createAvatar({ name: 'x' }, file, false),
      ).rejects.toBe(failure);
    });
  });
});
