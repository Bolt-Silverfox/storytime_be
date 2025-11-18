import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ProfileDto } from './profile.dto';
import { User, Profile, Role } from '@prisma/client';

export class UserDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: 'test@gmail.com' })
  email: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Optional()
  name: string | null;

  @ApiProperty({ example: 'https://avatar.com' })
  avatarUrl: string | null;

  @ApiProperty({ example: 'user' })
  role: Role;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ type: ProfileDto })
  profile?: ProfileDto | null;

  constructor(user: User & { profile?: Profile | null }) {
    this.id = user.id;
    this.email = user.email;
    this.name = user.name;
    this.avatarUrl = user.avatarUrl;
    this.role = user.role;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
    this.profile = user.profile ? new ProfileDto(user.profile) : null;
  }
}
