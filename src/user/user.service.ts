import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import { UpdateUserDto } from './dto/user.dto';
import { hashPin, verifyPinHash } from './utils/pin.util';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export class UserService {
  async getUser(id: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: { profile: true, kids: true, avatar: true },
    });
    if (!user) return null;

    return { ...user, numberOfKids: user.kids.length };
  }

  async getAllUsers(): Promise<any[]> {
    return prisma.user.findMany({
      include: { profile: true, avatar: true },
    });
  }

  async deleteUser(id: string): Promise<any> {
    return prisma.user.delete({ where: { id } });
  }

  async deleteUserAccount(id: string): Promise<any> {
    return prisma.user.delete({ where: { id } });
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updateData: any = {};
    const profileUpdate: any = {};

    // -------- USER FIELDS --------
    if (data.title !== undefined) updateData.title = data.title;
    if (data.name !== undefined) updateData.name = data.name;

    // Avatar logic
    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    } else if (data.avatarUrl !== undefined) {
      const newAvatar = await prisma.avatar.create({
        data: {
          url: data.avatarUrl,
          name: `Custom Avatar for ${id}`,
          isSystemAvatar: false,
        },
      });
      updateData.avatarId = newAvatar.id;
    }

    // -------- PROFILE FIELDS --------
    if (data.language !== undefined) profileUpdate.language = data.language;
    if (data.country !== undefined) profileUpdate.country = data.country;

    // If nothing to update, return existing
    if (
      Object.keys(updateData).length === 0 &&
      Object.keys(profileUpdate).length === 0
    ) {
      return this.getUser(id);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...updateData,
        ...(Object.keys(profileUpdate).length > 0 && {
          profile: {
            upsert: {
              create: profileUpdate,
              update: profileUpdate,
            },
          },
        }),
      },
      include: { profile: true, kids: true, avatar: true },
    });

    return {
      ...updatedUser,
      numberOfKids: updatedUser.kids.length,
    };
  }

  async getUserRole(id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    return { id: u?.id, role: u?.role };
  }

  async updateUserRole(id: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      include: { avatar: true },
    });

    return { id: user.id, role: user.role };
  }

  // ----------------------------------------------------------
  // PARENT PROFILE
  // ----------------------------------------------------------

  async updateParentProfile(userId: string, data: any) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) throw new NotFoundException('User not found');

    const updateUser: any = {};
    const updateProfile: any = {};

    if (data.name !== undefined) updateUser.name = data.name;
    if (data.title !== undefined) updateUser.title = data.title;
    if (data.language !== undefined) updateProfile.language = data.language;
    if (data.country !== undefined) updateProfile.country = data.country;

    return prisma.user.update({
      where: { id: userId },
      data: {
        ...updateUser,
        ...(Object.keys(updateProfile).length > 0 && {
          profile: {
            upsert: {
              create: updateProfile,
              update: updateProfile,
            },
          },
        }),
      },
      include: { profile: true, avatar: true },
    });
  }

  async updateAvatarForParent(userId: string, body: any) {
    if (!body.avatarId) throw new BadRequestException('avatarId is required');

    return prisma.user.update({
      where: { id: userId },
      data: { avatarId: body.avatarId },
      include: { avatar: true },
    });
  }

  // ----------------------------------------------------------
  // BIOMETRICS + PIN
  // ----------------------------------------------------------

  async setBiometrics(userId: string, enable: boolean) {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { enableBiometrics: enable },
    });

    return {
      success: true,
      enableBiometrics: !!updated.enableBiometrics,
    };
  }

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin))
      throw new BadRequestException('PIN must be exactly 6 digits');

    const hash = await hashPin(pin);

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: hash },
    });

    return { success: true, message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pinHash) throw new BadRequestException('No PIN is set');

    const match = await verifyPinHash(pin, user.pinHash);
    if (!match) throw new BadRequestException('Incorrect PIN');

    return { success: true };
  }

  async resetPin(userId: string, oldPin: string, newPin: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pinHash) throw new BadRequestException('No PIN set');

    const ok = await verifyPinHash(oldPin, user.pinHash);
    if (!ok) throw new BadRequestException('Old PIN incorrect');

    const hash = await hashPin(newPin);

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: hash },
    });

    return { success: true };
  }

  // ----------------------------------------------------------
  // DELETE ACCOUNT
  // ----------------------------------------------------------

  async deleteAccountWithConfirmation(
    userId: string,
    password: string,
    reasons?: string[],
    notes?: string,
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new BadRequestException('Invalid password');

    await prisma.supportTicket.create({
      data: {
        userId,
        subject: 'Delete Account Request',
        message: [
          'Deletion request submitted',
          reasons?.length ? `Reasons: ${reasons.join(', ')}` : '',
          notes ? `Notes: ${notes}` : '',
        ].join('\n'),
      },
    });

    await prisma.user.delete({ where: { id: userId } });

    return { success: true };
  }
}