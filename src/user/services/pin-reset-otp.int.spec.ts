import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { USER_REPOSITORY } from '../repositories';
import { PrismaUserRepository } from '../repositories/prisma-user.repository';
import { UserService } from '../user.service';
import { UserPinService } from './user-pin.service';
import { hashPin, verifyPinHash } from '../utils/pin.util';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

type PinResetFlows = Pick<
  UserPinService,
  'requestPinResetOtp' | 'validatePinResetOtp' | 'resetPinWithOtp'
>;

describeDb.each([
  ['UserService', UserService],
  ['UserPinService', UserPinService],
] as const)('PIN reset OTP via %s (real Postgres)', (_name, flowClass) => {
  const prisma = new PrismaClient();
  const tag = `pinotp_${Date.now()}_${_name}`;
  let n = 0;
  let flows: PinResetFlows;
  const sentOtps = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        UserPinService,
        { provide: PrismaService, useValue: prisma },
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        {
          provide: NotificationService,
          useValue: {
            sendNotification: (_type: string, data: Record<string, string>) => {
              sentOtps.set(data.email, data.otp);
              return Promise.resolve({ success: true });
            },
          },
        },
      ],
    }).compile();
    flows = moduleRef.get<PinResetFlows>(flowClass);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  const makeUser = async () =>
    prisma.user.create({
      data: {
        email: `${tag}_${n++}@example.com`,
        passwordHash: 'x',
        pinHash: await hashPin('111111'),
      },
    });

  const issue = async (user: { id: string; email: string }) => {
    await flows.requestPinResetOtp(user.id);
    return sentOtps.get(user.email)!;
  };

  const wrongOtp = (otp: string) =>
    String((Number(otp) + 1) % 1_000_000).padStart(6, '0');

  const currentPinHash = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pinHash!;

  it('resets the PIN with the emailed code and consumes it', async () => {
    const user = await makeUser();
    const otp = await issue(user);

    await expect(
      flows.resetPinWithOtp(user.id, otp, '222222'),
    ).resolves.toMatchObject({ success: true });

    expect(await verifyPinHash('222222', await currentPinHash(user.id))).toBe(
      true,
    );
    expect(
      await prisma.token.count({
        where: { userId: user.id, type: 'pin_reset' },
      }),
    ).toBe(0);
  });

  it('lets only one of two concurrent resets with the same code succeed', async () => {
    const user = await makeUser();
    const otp = await issue(user);

    const results = await Promise.allSettled([
      flows.resetPinWithOtp(user.id, otp, '333333'),
      flows.resetPinWithOtp(user.id, otp, '444444'),
    ]);

    const winners = results.flatMap((r, i) =>
      r.status === 'fulfilled' ? [i] : [],
    );
    const losers = results.flatMap((r) =>
      r.status === 'rejected' ? [r.reason as Error] : [],
    );
    expect(winners).toHaveLength(1);
    expect(losers[0].message).toBe('Invalid OTP');
    const winningPin = winners[0] === 0 ? '333333' : '444444';
    expect(await verifyPinHash(winningPin, await currentPinHash(user.id))).toBe(
      true,
    );
  });

  it('rejects a code that expires while the claim waits for the row lock', async () => {
    const user = await makeUser();
    const otp = await issue(user);
    await prisma.token.updateMany({
      where: { userId: user.id, type: 'pin_reset' },
      data: { expiresAt: new Date(Date.now() + 400) },
    });

    let releaseLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      void prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
          resolve();
          await new Promise<void>((release) => (releaseLock = release));
        },
        { timeout: 10_000 },
      );
    });
    await lockHeld;

    const attempt = flows.resetPinWithOtp(user.id, otp, '555555');
    await new Promise((r) => setTimeout(r, 800));
    releaseLock();

    await expect(attempt).rejects.toThrow('OTP has expired');
    expect(await verifyPinHash('111111', await currentPinHash(user.id))).toBe(
      true,
    );
  });

  it('refuses the right code after five wrong guesses', async () => {
    const user = await makeUser();
    const otp = await issue(user);

    for (let i = 0; i < 5; i++) {
      await expect(
        flows.validatePinResetOtp(user.id, wrongOtp(otp)),
      ).rejects.toThrow('Invalid OTP');
    }

    await expect(flows.resetPinWithOtp(user.id, otp, '666666')).rejects.toThrow(
      'Invalid OTP',
    );
    expect(await verifyPinHash('111111', await currentPinHash(user.id))).toBe(
      true,
    );
  });

  it('does not charge a guess when the right code is presented', async () => {
    const user = await makeUser();
    const otp = await issue(user);

    for (let i = 0; i < 4; i++) {
      await expect(
        flows.validatePinResetOtp(user.id, wrongOtp(otp)),
      ).rejects.toThrow('Invalid OTP');
    }
    for (let i = 0; i < 3; i++) {
      await expect(
        flows.validatePinResetOtp(user.id, otp),
      ).resolves.toMatchObject({ success: true });
    }

    await expect(
      flows.resetPinWithOtp(user.id, otp, '777777'),
    ).resolves.toMatchObject({ success: true });
  });

  it('keeps the guess budget when a new code is requested', async () => {
    const user = await makeUser();
    const otp = await issue(user);
    for (let i = 0; i < 5; i++) {
      await expect(
        flows.validatePinResetOtp(user.id, wrongOtp(otp)),
      ).rejects.toThrow('Invalid OTP');
    }

    await expect(flows.requestPinResetOtp(user.id)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it("leaves another user's code alone when charging a wrong guess", async () => {
    const victim = await makeUser();
    const other = await makeUser();
    const victimOtp = await issue(victim);
    const otherOtp = await issue(other);

    for (let i = 0; i < 5; i++) {
      await expect(
        flows.validatePinResetOtp(other.id, wrongOtp(otherOtp)),
      ).rejects.toThrow('Invalid OTP');
    }

    await expect(
      flows.resetPinWithOtp(victim.id, victimOtp, '888888'),
    ).resolves.toMatchObject({ success: true });
  });

  it('lets two users hold the same code at the same time', async () => {
    const first = await makeUser();
    const second = await makeUser();
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const crypto = jest.requireActual<typeof import('crypto')>('crypto');
    const randomIntSpy = jest
      .spyOn(crypto, 'randomInt')
      .mockImplementation(() => 123456);
    try {
      await issue(first);
      await issue(second);
    } finally {
      randomSpy.mockRestore();
      randomIntSpy.mockRestore();
    }

    expect(sentOtps.get(first.email)).toBe(sentOtps.get(second.email));
  });
});
