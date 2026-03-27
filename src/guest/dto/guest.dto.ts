import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

export class UpdateGuestProgressDto {
  @ApiProperty({ description: 'Story ID' })
  @IsString()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty({ description: 'Reading progress percentage (0-100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  progress: number;
}

export class CreateGuestSessionResponseDto {
  @ApiProperty({ description: 'Guest session ID (UUID)' })
  sessionId: string;

  @ApiProperty({ description: 'Session creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Session TTL in seconds' })
  expiresIn: number;
}

export class GuestProgressResponseDto {
  @ApiProperty({ description: 'Story ID' })
  storyId: string;

  @ApiProperty({ description: 'Reading progress percentage' })
  progress: number;

  @ApiProperty({ description: 'Last accessed timestamp' })
  lastAccessed: Date;
}

export class GuestHistoryResponseDto {
  @ApiProperty({
    description: 'List of stories with reading progress',
    type: [GuestProgressResponseDto],
  })
  stories: GuestProgressResponseDto[];
}
