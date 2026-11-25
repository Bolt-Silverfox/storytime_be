import { NotFoundException } from '@nestjs/common';
import { AvatarService } from './avatar.service';

describe('AvatarService assignment ownership', () => {
  const bobsAvatar = {
    id: 'a-bob',
    name: 'user-avatar-bob',
    isSystemAvatar: false,
  };
  const bobsKidAvatar = {
    id: 'a-bob-kid',
    name: 'kid-avatar-bobkid',
    isSystemAvatar: false,
  };
  const aliceAvatar = {
    id: 'a-alice',
    name: 'user-avatar-alice',
    isSystemAvatar: false,
  };
  const aliceKidAvatar = {
    id: 'a-alice-kid',
    name: 'kid-avatar-alicekid',
    isSystemAvatar: false,
  };
  const systemAvatar = { id: 'a-sys', name: 'lion', isSystemAvatar: true };
  const avatars = [
    bobsAvatar,
    bobsKidAvatar,
    aliceAvatar,
    aliceKidAvatar,
    systemAvatar,
  ];

  let repo: Record<string, jest.Mock>;
  let service: AvatarService;

  beforeEach(() => {
    repo = {
      findUserById: jest.fn().mockResolvedValue({ id: 'alice' }),
      findKidById: jest.fn().mockResolvedValue({ id: 'alicekid' }),
      findByIdNotDeleted: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(avatars.find((a) => a.id === id) ?? null),
        ),
      updateUserAvatar: jest.fn().mockResolvedValue({ id: 'alice' }),
      updateKidAvatar: jest.fn().mockResolvedValue({ id: 'alicekid' }),
    };
    service = new AvatarService(repo as never, {} as never);
  });

  it('rejects another owner custom avatar for a user as not found', async () => {
    await expect(service.assignAvatarToUser('alice', 'a-bob')).rejects.toThrow(
      new NotFoundException('Avatar not found'),
    );
    expect(repo.updateUserAvatar).not.toHaveBeenCalled();
  });

  it('rejects another owner custom avatar for a kid as not found', async () => {
    await expect(
      service.assignAvatarToKid('alicekid', 'a-bob-kid'),
    ).rejects.toThrow(new NotFoundException('Avatar not found'));
    expect(repo.updateKidAvatar).not.toHaveBeenCalled();
  });

  it('rejects a kid avatar assigned to a user and a user avatar to a kid', async () => {
    await expect(
      service.assignAvatarToUser('alice', 'a-alice-kid'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.assignAvatarToKid('alicekid', 'a-alice'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives a missing avatar and a foreign avatar the same error', async () => {
    const missing = await service
      .assignAvatarToUser('alice', 'nope')
      .catch((e: Error) => e.message);
    const foreign = await service
      .assignAvatarToUser('alice', 'a-bob')
      .catch((e: Error) => e.message);
    expect(foreign).toBe(missing);
  });

  it('assigns a system avatar to a user and a kid', async () => {
    await service.assignAvatarToUser('alice', 'a-sys');
    await service.assignAvatarToKid('alicekid', 'a-sys');
    expect(repo.updateUserAvatar).toHaveBeenCalledWith('alice', 'a-sys');
    expect(repo.updateKidAvatar).toHaveBeenCalledWith('alicekid', 'a-sys');
  });

  it('assigns the owner own custom avatar to a user and a kid', async () => {
    await service.assignAvatarToUser('alice', 'a-alice');
    await service.assignAvatarToKid('alicekid', 'a-alice-kid');
    expect(repo.updateUserAvatar).toHaveBeenCalledWith('alice', 'a-alice');
    expect(repo.updateKidAvatar).toHaveBeenCalledWith(
      'alicekid',
      'a-alice-kid',
    );
  });
});
