import { ApiProperty } from '@nestjs/swagger';

export class ProfileDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: true })
  explicitContent: boolean;

  @ApiProperty({ example: 50 })
  maxScreenTimeMins: number | null;

  @ApiProperty({ example: 'english' })
  language: string | null;

  @ApiProperty({ example: 'nigeria' })
  country: string | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  constructor(profile: Partial<ProfileDto>) {
    Object.assign(this, profile);
  }
}
