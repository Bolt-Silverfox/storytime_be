import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { UserRole } from './user.controller';
import { KidVoiceDto, UpdateUserDto } from './dto/user.dto';
import { VoiceType } from '@/story/story.dto';
import { hashPin, verifyPinHash } from './utils/pin.util';
import * as bcrypt from 'bcrypt';


const prisma = new PrismaClient();

@Injectable()
export class UserService {
  async getUser(id: string): Promise<any> {
    // Fetch user, profile, and kids count
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        kids: true,
        avatar: true,
      },
    });
    if (!user) return null;
    return {
      ...user,
      numberOfKids: user.kids ? user.kids.length : 0,
    };
  }

  async getAllUsers(): Promise<any[]> {
    return await prisma.user.findMany({
      include: {
        profile: true,
        avatar: true,
      },
    });
  }

  async deleteUser(id: string): Promise<any> {
    return await prisma.user.delete({
      where: { id },
    });
  }

  async deleteUserAccount(id: string): Promise<any> {
    return await prisma.user.delete({
      where: { id },
    });
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<any> {
    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Build update payload dynamically - only include fields that are provided
    const updateData: any = {};

    if (data.title !== undefined) {
      updateData.title = data.title;
    }

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    // Use avatarId if provided, otherwise fall back to avatarUrl for backwards compatibility
    if (data.avatarId !== undefined) {
      updateData.avatarId = data.avatarId;
    } else if (data.avatarUrl !== undefined) {
      updateData.avatarId = data.avatarUrl;
    }

    // Build profile update data
    const profileUpdateData: any = {};
    if (data.language !== undefined) {
      profileUpdateData.language = data.language;
    }
    if (data.country !== undefined) {
      profileUpdateData.country = data.country;
    }

    // If no fields to update, return existing user
    if (
      Object.keys(updateData).length === 0 &&
      Object.keys(profileUpdateData).length === 0
    ) {
      return this.getUser(id);
    }

    // Update user with only provided fields
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...updateData,
        ...(Object.keys(profileUpdateData).length > 0 && {
          profile: {
            upsert: {
              create: profileUpdateData,
              update: profileUpdateData,
            },
          },
        }),
      },
      include: {
        profile: true,
        avatar: true,
        kids: true,
      },
    });

    return {
      ...updatedUser,
      numberOfKids: updatedUser.kids ? updatedUser.kids.length : 0,
    };
  }

  async getUserRole(id: string): Promise<any> {
    const user = await prisma.user.findUnique({ where: { id } });
    return { id: user?.id, role: user?.role };
  }

  async updateUserRole(id: string, role: UserRole): Promise<any> {
    if (!Object.values(UserRole).includes(role)) {
      throw new Error('Invalid role');
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      include: {
        avatar: true,
      },
    });
    return { id: user.id, role: user.role };
  }

  async setKidPreferredVoice(
    kidId: string,
    voiceType: VoiceType,
  ): Promise<KidVoiceDto> {
    const voice = await prisma.voice.findFirst({
      where: { name: voiceType },
    });
    if (!voice) {
      throw new Error(`Voice type ${voiceType} not found`);
    }

    const kid = await prisma.kid.update({
      where: { id: kidId },
      data: { preferredVoiceId: voice.id },
    });
    return {
      kidId: kid.id,
      voiceType,
      preferredVoiceId: kid.preferredVoiceId!,
    };
  }

  //get kid by kidID
  async getKidById(kidId: string) {
    try {
      const kid = await prisma.kid.findUnique({
        where: { id: kidId },
        include: {
          avatar: true,
          parent: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!kid) {
        throw new NotFoundException('Kid not found');
      }

      return kid;
    } catch (error) {
      throw error;
    }
  }

  async getKidPreferredVoice(kidId: string): Promise<KidVoiceDto | null> {
    const kid = await prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        avatar: true,
      },
    });
    if (!kid || !kid.preferredVoiceId)
      return { kidId, voiceType: VoiceType.MILO, preferredVoiceId: '' };

    const voice = await prisma.voice.findUnique({
      where: { id: kid.preferredVoiceId },
    });
    return {
      kidId: kid.id,
      voiceType: (voice?.name?.toUpperCase() as VoiceType) || VoiceType.MILO,
      preferredVoiceId: kid.preferredVoiceId,
    };
  }

  // ------------------------------------------------------------
  // PARENT PROFILE LOGIC 
  // ------------------------------------------------------------

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
    if (!body.avatarId) {
      throw new BadRequestException('avatarId is required');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return prisma.user.update({
      where: { id: userId },
      data: { avatarId: body.avatarId },
      include: { avatar: true },
    });
  }

  async setBiometrics(userId: string, enable: boolean) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { enableBiometrics: enable },
    });

    return {
      success: true,
      message: enable ? 'Biometrics enabled successfully' : 'Biometrics disabled successfully',
      enableBiometrics: !!updated.enableBiometrics,
    };
  }

  async setPin(userId: string, pin: string) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new BadRequestException('PIN must be exactly 6 digits');
    }

    const hash = await hashPin(pin);

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: hash },
    });

    return {
      success: true,
      message: 'PIN set successfully',
    };
  }

  async verifyPin(userId: string, pin: string) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new BadRequestException('PIN must be exactly 6 digits');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('No PIN is set for this account');
    }

    const isMatch = await verifyPinHash(pin, user.pinHash);

    if (!isMatch) {
      throw new BadRequestException('Incorrect PIN');
    }

    return {
      success: true,
      message: 'PIN verified successfully',
    };
  }

  async resetPin(userId: string, oldPin: string, newPin: string) {
    if (!oldPin || !/^\d{6}$/.test(oldPin)) {
      throw new BadRequestException('Old PIN must be exactly 6 digits');
    }
    if (!newPin || !/^\d{6}$/.test(newPin)) {
      throw new BadRequestException('New PIN must be exactly 6 digits');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pinHash) {
      throw new BadRequestException('No PIN is set for this account');
    }

    const oldMatch = await verifyPinHash(oldPin, user.pinHash);
    if (!oldMatch) {
      throw new BadRequestException('Old PIN is incorrect');
    }

    const newHash = await hashPin(newPin);

    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: newHash },
    });

    return {
      success: true,
      message: 'PIN reset successfully',
    };
  }

  // ------------------------------------------------------------


  // DELETE ACCOUNT WITH CONFIRMATION
  async deleteAccountWithConfirmation(userId: string, password: string, reasons?: string[], notes?: string) {
    // fetch user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // verify password
    if (!user.passwordHash) {
      throw new BadRequestException('No password is set for this account');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('Invalid password');
    }

    // create support ticket capturing reasons (so product/support can follow up)
    const messageLines = [
      'Delete account request from user.',
      reasons && reasons.length ? `Reasons: ${reasons.join('; ')}` : 'No reasons provided',
      notes ? `Notes: ${notes}` : '',
      `UserId: ${userId}`,
      `Email: ${user.email}`,
    ];
    await prisma.supportTicket.create({
      data: {
        userId,
        subject: 'Delete Account Request',
        message: messageLines.filter(Boolean).join('\n'),
      },
    });

    // delete user and cascade (prisma onDelete cascade will remove related entities if configured)
    await prisma.user.delete({ where: { id: userId } });

    return { success: true, message: 'Account deleted successfully' };
  }

}