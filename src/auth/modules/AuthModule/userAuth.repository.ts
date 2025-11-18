import { Injectable } from '@nestjs/common';
import PrismaService from 'src/prisma/prisma.service';
import { User, Session, Token, TokenType } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class UserAuthRepository {
  constructor(private prisma: PrismaService) {}

  async findUserByEmail(
    email: string,
  ): Promise<(User & { profile?: any }) | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
  }

  async createUser(data: RegisterDto, hashedPassword: string): Promise<User> {
    return this.prisma.user.create({
      data: {
        name: data.fullName,
        email: data.email,
        passwordHash: hashedPassword,
        title: data.title,
        profile: { create: {} },
      },
    });
  }

  async findSessionByToken(
    token: string,
  ): Promise<(Session & { user: User }) | null> {
    return this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  async findSessionById(sessionId: string): Promise<Session | null> {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
    });
  }

  async deleteSession(sessionId: string): Promise<Session> {
    return this.prisma.session.delete({ where: { id: sessionId } });
  }

  async deleteManySessionsByUserId(userId: string): Promise<any> {
    return this.prisma.session.deleteMany({ where: { userId } });
  }

  async createSession(
    userId: string,
    hashedToken: string,
    expiresAt: Date,
  ): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId,
        token: hashedToken,
        expiresAt,
      },
    });
  }

  async deleteManyTokensByUserIdAndType(
    userId: string,
    type: TokenType,
  ): Promise<any> {
    return this.prisma.token.deleteMany({
      where: { userId, type },
    });
  }

  async createToken(
    userId: string,
    hashedToken: string,
    expiresAt: Date,
    type: TokenType,
  ): Promise<Token> {
    return this.prisma.token.create({
      data: {
        userId,
        hashedToken,
        expiresAt,
        type,
      },
    });
  }

  async findTokenByHashedTokenAndType(
    hashedToken: string,
    type: TokenType,
  ): Promise<(Token & { user: User }) | null> {
    return this.prisma.token.findUnique({
      where: { hashedToken, type },
      include: { user: true },
    });
  }

  async deleteToken(tokenId: string): Promise<Token> {
    return this.prisma.token.delete({ where: { id: tokenId } });
  }

  async updateUserEmailVerifiedStatus(
    userId: string,
    isEmailVerified: boolean,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified },
    });
  }

  async updateUserPassword(
    userId: string,
    passwordHash: string,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
