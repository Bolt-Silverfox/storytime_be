import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class SettingsService {
  async getSettings(userId: string): Promise<any> {
    let profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.profile.create({ data: { userId } });
    }
    return profile;
  }

  async updateSettings(userId: string, body: any): Promise<any> {
    let profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.profile.create({ data: { userId } });
    }
    // Validation
    const updateData: any = {};
    if (body.explicitContent !== undefined) {
      if (typeof body.explicitContent !== 'boolean') {
        throw new Error('explicitContent must be a boolean');
      }
      updateData.explicitContent = body.explicitContent;
    }
    if (body.maxScreenTimeMins !== undefined) {
      if (
        typeof body.maxScreenTimeMins !== 'number' ||
        body.maxScreenTimeMins < 0
      ) {
        throw new Error('maxScreenTimeMins must be a positive number');
      }
      updateData.maxScreenTimeMins = body.maxScreenTimeMins;
    }
    if (body.language !== undefined) {
      if (typeof body.language !== 'string') {
        throw new Error('language must be a string');
      }
      updateData.language = body.language;
    }
    if (body.country !== undefined) {
      if (typeof body.country !== 'string') {
        throw new Error('country must be a string');
      }
      updateData.country = body.country;
    }
    if (Object.keys(updateData).length === 0) {
      return profile;
    }
    return await prisma.profile.update({
      where: { userId },
      data: updateData,
    });
  }
}
