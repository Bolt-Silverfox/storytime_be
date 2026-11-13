import { BadRequestException } from '@nestjs/common';
import { AvatarService } from './avatar.service';

describe('AvatarService custom avatar replacement', () => {
  const order: string[] = [];
  const oldRow = {
    id: 'old',
    publicId: 'old-asset',
    isSystemAvatar: false,
  };
  const repo = {
    findUserWithAvatar: jest.fn(),
    findKidWithAvatar: jest.fn(),
    findById: jest.fn(),
    replaceByName: jest.fn(),
    updateUserAvatar: jest.fn(),
    updateKidAvatar: jest.fn(),
    retireAvatarIfUnreferenced: jest.fn(),
  };
  const upload = { uploadImage: jest.fn(), deleteImage: jest.fn() };
  const service = new AvatarService(repo as never, upload as never);
  const file = {} as never;

  beforeEach(() => {
    jest.resetAllMocks();
    order.length = 0;
    repo.findUserWithAvatar.mockResolvedValue({
      id: 'u1',
      avatarId: 'old',
      email: 'u@example.com',
    });
    repo.findKidWithAvatar.mockResolvedValue({ id: 'k1', avatarId: 'old' });
    repo.findById.mockResolvedValue(oldRow);
    upload.uploadImage.mockImplementation(() => {
      order.push('upload');
      return Promise.resolve({ secure_url: 'u', public_id: 'new-asset' });
    });
    repo.replaceByName.mockResolvedValue({
      avatar: { id: 'new', publicId: 'new-asset' },
      displacedPublicId: null,
    });
    repo.updateUserAvatar.mockImplementation(() => {
      order.push('assign');
      return Promise.resolve({ id: 'u1' });
    });
    repo.updateKidAvatar.mockImplementation(() => {
      order.push('assign');
      return Promise.resolve({ id: 'k1' });
    });
    repo.retireAvatarIfUnreferenced.mockImplementation(() => {
      order.push('retire');
      return Promise.resolve('old-asset');
    });
    upload.deleteImage.mockImplementation((id: string) => {
      order.push(`delete:${id}`);
      return Promise.resolve();
    });
  });

  const flows = [
    ['user', () => service.uploadAndAssignUserAvatar('u1', file)],
    ['kid', () => service.uploadAndAssignKidAvatar('k1', file)],
  ] as const;

  describe.each(flows)('%s avatar', (_who, run) => {
    it('uploads and assigns first, then retires and destroys the old asset', async () => {
      await run();
      expect(order).toEqual(['upload', 'assign', 'retire', 'delete:old-asset']);
    });

    it('leaves the old avatar untouched when the upload fails', async () => {
      upload.uploadImage.mockRejectedValue(new Error('cdn down'));
      await expect(run()).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('does not destroy an asset another user or kid still uses', async () => {
      repo.retireAvatarIfUnreferenced.mockResolvedValue(null);
      await run();
      expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledWith('old');
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('destroys the asset the upsert displaced when the row is reused', async () => {
      repo.replaceByName.mockResolvedValue({
        avatar: { id: 'old', publicId: 'new-asset' },
        displacedPublicId: 'old-asset',
      });
      await run();
      expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      expect(upload.deleteImage).toHaveBeenCalledWith('old-asset');
    });

    it('destroys the displaced asset even when the previous avatar is a system avatar', async () => {
      repo.findById.mockResolvedValue({ ...oldRow, isSystemAvatar: true });
      repo.replaceByName.mockResolvedValue({
        avatar: { id: 'named-row', publicId: 'new-asset' },
        displacedPublicId: 'p1',
      });
      await run();
      expect(upload.deleteImage).toHaveBeenCalledTimes(1);
      expect(upload.deleteImage).toHaveBeenCalledWith('p1');
    });

    it('does nothing for a displaced asset when the upsert displaced none', async () => {
      repo.retireAvatarIfUnreferenced.mockResolvedValue(null);
      await run();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('does not touch a system avatar', async () => {
      repo.findById.mockResolvedValue({ ...oldRow, isSystemAvatar: true });
      await run();
      expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('still succeeds when releasing the old avatar fails', async () => {
      upload.deleteImage.mockRejectedValue(new Error('cdn down'));
      await expect(run()).resolves.toBeDefined();
    });
  });

  it('concurrent uploads by one user each destroy only the asset they displaced', async () => {
    repo.replaceByName
      .mockResolvedValueOnce({
        avatar: { id: 'row', publicId: 'p1' },
        displacedPublicId: 'p0',
      })
      .mockResolvedValueOnce({
        avatar: { id: 'row', publicId: 'p2' },
        displacedPublicId: 'p1',
      });
    repo.retireAvatarIfUnreferenced.mockResolvedValue(null);
    await Promise.all([
      service.uploadAndAssignUserAvatar('u1', file),
      service.uploadAndAssignUserAvatar('u1', file),
    ]);
    const destroyed = upload.deleteImage.mock.calls.map((c: [string]) => c[0]);
    expect(destroyed.sort()).toEqual(['p0', 'p1']);
  });
});
