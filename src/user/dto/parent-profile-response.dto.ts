import { ApiProperty } from '@nestjs/swagger';

class AvatarDto {
  @ApiProperty({ example: 'avatar-uuid' })
  id: string;

  @ApiProperty({ example: 'https://cdn...' })
  url: string;

  @ApiProperty({ example: true })
  isSystemAvatar: boolean;
}

class ProfileDto {
  @ApiProperty({ example: true })
  explicitContent: boolean;

  @ApiProperty({ example: 60 })
  maxScreenTimeMins?: number;

  @ApiProperty({ example: 'en' })
  language?: string;

  @ApiProperty({ example: 'Nigeria' })
  country?: string;
}

export class ParentProfileResponseDto {
  @ApiProperty({ example: 'uuid-user-123' })
  id: string;

  @ApiProperty({ example: 'parent@example.com' })
  email: string;

  @ApiProperty({ example: 'Mrs Daisy Luke' })
  name?: string;

  @ApiProperty({ type: AvatarDto, required: false })
  avatar?: AvatarDto;

  @ApiProperty({ type: ProfileDto, required: false })
  profile?: ProfileDto;

  @ApiProperty({ example: 'parent' })
  role: string;

  @ApiProperty({ example: 1 })
  numberOfKids: number;

  @ApiProperty({ example: true })
  pinSet?: boolean;

  @ApiProperty({ example: true })
  enableBiometrics?: boolean;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'active' })
  subscriptionStatus?: string;
}
