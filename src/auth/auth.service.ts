// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async getKids(parentId: string) {
    return this.prisma.kid.findMany({ where: { parentId } });
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
  ///////////////////////////
  // User Registration
  ///////////////////////////
  async registerUser(data: {
    email: string;
    password: string;
    name: string;
    role?: 'parent' | 'admin';
    title?: string;
    phoneNumber?: string;
    address?: string;
    preferredVoiceId?: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      throw new UnauthorizedException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: data.role ?? 'parent',
        title: data.title,
        phoneNumber: data.phoneNumber,
        address: data.address,
        preferredVoiceId: data.preferredVoiceId,
        profile: {
          create: {
            explicitContent: false,
            maxScreenTimeMins: 0,
            language: 'en',
            country: 'unknown',
          },
        },
      },
      include: {
        profile: true,
      },
    });

    const token = this.generateToken(user.id, user.role, user.email);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
      },
    });

    return { user, token };
  }

  ///////////////////////////
  // User Login
  ///////////////////////////
  async loginUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      throw new UnauthorizedException('Invalid credentials');

    const token = this.generateToken(user.id, user.role, user.email);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });

    return { user, token };
  }

  ///////////////////////////
  // Kid Registration
  ///////////////////////////
  async addKid(
    parentId: string,
    data: {
      name: string;
      avatarId?: string;
      ageRange?: string;
      favoriteColor?: string;
      preferredVoiceId?: string;
    },
  ) {
    const kid = await this.prisma.kid.create({
      data: {
        parentId,
        name: data.name,
        avatarId: data.avatarId,
        ageRange: data.ageRange ?? 'default-range',
        favoriteColor: data.favoriteColor,
        preferredVoiceId: data.preferredVoiceId,
      },
    });
    return kid;
  }

  ///////////////////////////
  // Token Generation
  ///////////////////////////
  generateToken(userId: string, role: string, email?: string) {
    return this.jwtService.sign({ sub: userId, role, email });
  }

  ///////////////////////////
  // Validate User by Token
  ///////////////////////////
  async validateUserByToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException();
      return user;
    } catch (err) {
      throw new UnauthorizedException();
    }
  }
}
