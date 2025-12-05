import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class BiometricsService {
  async enableBiometrics(userId: string, deviceId: string, hasBiometrics: boolean) {
    if (!hasBiometrics) {
      throw new BadRequestException('Device does not support biometrics');
    }

    const record = await prisma.deviceAuth.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { biometricsOn: true },
      create: { userId, deviceId, biometricsOn: true },
    });

    return { success: true, deviceId, biometricsOn: record.biometricsOn };
  }

  async disableBiometrics(userId: string, deviceId: string) {
    await prisma.deviceAuth.updateMany({
      where: { userId, deviceId },
      data: { biometricsOn: false },
    });

    return { success: true };
  }

  async biometricsStatus(userId: string, deviceId: string) {
    const record = await prisma.deviceAuth.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });

    return { deviceId, biometricsOn: record?.biometricsOn ?? false };
  }

  async revokeOtherUsersOnDevice(deviceId: string, currentUserId: string) {
    await prisma.deviceAuth.updateMany({
      where: { deviceId, userId: { not: currentUserId } },
      data: { biometricsOn: false },
    });
  }
}
