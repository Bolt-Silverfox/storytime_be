import { ApiProperty } from '@nestjs/swagger';

export class KidHistoryItemDto {
  @ApiProperty()
  storyId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  coverImage: string;

  @ApiProperty()
  progress: number;

  @ApiProperty()
  timeSpent: number;

  @ApiProperty()
  lastRead: Date;
}

export class KidHistoryResponseDto {
  @ApiProperty({ type: [KidHistoryItemDto] })
  history: KidHistoryItemDto[];
}
