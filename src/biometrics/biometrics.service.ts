import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BiometricsService {
  constructor(private readonly prisma: PrismaService) { }

  async enableBiometrics(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { biometricsEnabled: true },
    });
    return { success: true, biometricsEnabled: true };
  }

  async disableBiometrics(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { biometricsEnabled: false },
    });
    return { success: true, biometricsEnabled: false };
  }

  async biometricsStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { biometricsEnabled: true },
    });
    return { biometricsEnabled: user?.biometricsEnabled ?? false };
  }
}
