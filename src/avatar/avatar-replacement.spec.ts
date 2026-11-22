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
    replaceAndAssignUserAvatar: jest.fn(),
    replaceAndAssignKidAvatar: jest.fn(),
    retireAvatarIfUnreferenced: jest.fn(),
  };
  const upload = { uploadImage: jest.fn(), deleteImage: jest.fn() };
  const service = new AvatarService(repo as never, upload as never);
  const file = {} as never;
  let previousAvatar: typeof oldRow | null = oldRow;
  const previousRow = () => previousAvatar;
  let replaced: {
    avatar: { id: string; publicId: string };
    displaced: string | null;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    previousAvatar = oldRow;
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
    replaced = {
      avatar: { id: 'new', publicId: 'new-asset' },
      displaced: null,
    };
    repo.replaceAndAssignUserAvatar.mockImplementation(() => {
      order.push('assign');
      return Promise.resolve({
        user: { id: 'u1' },
        avatar: replaced.avatar,
        displacedPublicId: replaced.displaced,
        previous: previousRow(),
      });
    });
    repo.replaceAndAssignKidAvatar.mockImplementation(() => {
      order.push('assign');
      return Promise.resolve({
        kid: { id: 'k1' },
        avatar: replaced.avatar,
        displacedPublicId: replaced.displaced,
        previous: previousRow(),
      });
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
      replaced = {
        avatar: { id: 'old', publicId: 'new-asset' },
        displaced: 'old-asset',
      };
      await run();
      expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      expect(upload.deleteImage).toHaveBeenCalledWith('old-asset');
    });

    it('destroys the displaced asset even when the previous avatar is a system avatar', async () => {
      repo.findById.mockResolvedValue({ ...oldRow, isSystemAvatar: true });
      previousAvatar = { ...oldRow, isSystemAvatar: true };
      replaced = {
        avatar: { id: 'named-row', publicId: 'new-asset' },
        displaced: 'p1',
      };
      await run();
      expect(upload.deleteImage).toHaveBeenCalledTimes(1);
      expect(upload.deleteImage).toHaveBeenCalledWith('p1');
    });

    describe('when destroying the displaced asset fails', () => {
      beforeEach(() => {
        replaced = {
          avatar: { id: 'new', publicId: 'new-asset' },
          displaced: 'disp',
        };
        upload.deleteImage.mockImplementation((id: string) =>
          id === 'disp'
            ? Promise.reject(new Error('cdn down'))
            : Promise.resolve(),
        );
      });

      it('still retires and destroys the previous avatar after a successful assignment', async () => {
        await run();
        expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledWith('old');
        expect(upload.deleteImage).toHaveBeenCalledWith('old-asset');
      });
    });

    it('does nothing for a displaced asset when the upsert displaced none', async () => {
      repo.retireAvatarIfUnreferenced.mockResolvedValue(null);
      await run();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    describe('when the replacement and assignment transaction fails', () => {
      const failure = new Error('db down');

      beforeEach(() => {
        repo.replaceAndAssignUserAvatar.mockRejectedValue(failure);
        repo.replaceAndAssignKidAvatar.mockRejectedValue(failure);
      });

      it('rethrows and destroys only the asset it just uploaded', async () => {
        await expect(run()).rejects.toBe(failure);
        expect(upload.deleteImage).toHaveBeenCalledTimes(1);
        expect(upload.deleteImage).toHaveBeenCalledWith('new-asset');
        expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      });

      it('still rethrows when destroying the uploaded asset fails too', async () => {
        upload.deleteImage.mockRejectedValue(new Error('cdn down'));
        await expect(run()).rejects.toBe(failure);
      });
    });

    it('does not touch a system avatar', async () => {
      repo.findById.mockResolvedValue({ ...oldRow, isSystemAvatar: true });
      previousAvatar = { ...oldRow, isSystemAvatar: true };
      await run();
      expect(repo.retireAvatarIfUnreferenced).not.toHaveBeenCalled();
      expect(upload.deleteImage).not.toHaveBeenCalled();
    });

    it('still succeeds when releasing the old avatar fails', async () => {
      upload.deleteImage.mockRejectedValue(new Error('cdn down'));
      await expect(run()).resolves.toBeDefined();
    });
  });

  it('retires the avatar displaced at assignment time, not the one read before the upload', async () => {
    repo.findById.mockResolvedValue(oldRow);
    previousAvatar = {
      id: 'raced',
      publicId: 'raced-asset',
      isSystemAvatar: false,
    };
    repo.retireAvatarIfUnreferenced.mockResolvedValue('raced-asset');
    await service.uploadAndAssignUserAvatar('u1', file);
    expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledWith('raced');
    expect(upload.deleteImage).toHaveBeenCalledWith('raced-asset');
  });

  it('retires the kid avatar displaced at assignment time, not the one read before the upload', async () => {
    previousAvatar = {
      id: 'raced',
      publicId: 'raced-asset',
      isSystemAvatar: false,
    };
    repo.retireAvatarIfUnreferenced.mockResolvedValue('raced-asset');
    await service.uploadAndAssignKidAvatar('k1', file);
    expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(repo.retireAvatarIfUnreferenced).toHaveBeenCalledWith('raced');
  });

  it('concurrent uploads by one user each destroy only the asset they displaced', async () => {
    repo.replaceAndAssignUserAvatar
      .mockResolvedValueOnce({
        user: { id: 'u1' },
        avatar: { id: 'row', publicId: 'p1' },
        displacedPublicId: 'p0',
        previous: null,
      })
      .mockResolvedValueOnce({
        user: { id: 'u1' },
        avatar: { id: 'row', publicId: 'p2' },
        displacedPublicId: 'p1',
        previous: null,
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
