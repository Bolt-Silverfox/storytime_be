import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { JwtPayload } from '@/shared/guards/auth.guard';

const auth = (userId: string, userRole = 'user'): JwtPayload => ({
  userId,
  userRole,
  email: 'e@example.com',
  expiry: 0,
});

describe('AccessControlService input hardening', () => {
  const findFirst = jest.fn();
  const service = new AccessControlService({ kid: { findFirst } } as never);

  beforeEach(() => findFirst.mockReset().mockResolvedValue({ id: 'k' }));

  const garbage: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['an operator object', { not: 'z' }],
    ['an in-list object', { in: ['other-kid', 'own-kid'] }],
    ['an array', ['own-kid']],
    ['a number', 7],
  ];

  it.each(garbage)(
    'assertKidAccess rejects %s without querying, for users and admins',
    async (_label, value) => {
      await expect(
        service.assertKidAccess(auth('u1'), value as string),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.assertKidAccess(auth('a1', 'admin'), value as string),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(garbage)(
    'assertSelfOrAdmin rejects %s, for users and admins',
    (_label, value) => {
      expect(() =>
        service.assertSelfOrAdmin(auth('u1'), value as string),
      ).toThrow(BadRequestException);
      expect(() =>
        service.assertSelfOrAdmin(auth('a1', 'admin'), value as string),
      ).toThrow(BadRequestException);
    },
  );

  it('assertOwner rejects a non-string kid id instead of falling through', async () => {
    await expect(
      service.assertOwner(auth('u1'), { kidId: { not: 'z' } as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveUserId rejects a non-string requested id', () => {
    expect(() =>
      service.resolveUserId(auth('u1'), { not: 'x' } as never),
    ).toThrow(BadRequestException);
  });

  it('still refuses a kid the parent does not own', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.assertKidAccess(auth('u1'), 'someone-elses'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'someone-elses', parentId: 'u1', isDeleted: false },
      }),
    );
  });
});
