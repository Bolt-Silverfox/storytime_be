import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class KidHistoryItemDto {
  @ApiProperty()
  storyId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  coverImage: string | null;

  @ApiProperty()
  progress: number;

  @ApiProperty()
  totalTimeSpent: number;

  @ApiProperty()
  lastRead: Date;

  @ApiProperty()
  isFavorite: boolean;

  @ApiProperty()
  isDownloaded: boolean;
}

export class KidHistoryResponseDto {
  @ApiProperty({ type: [KidHistoryItemDto] })
  history: KidHistoryItemDto[];
}

export class HistoryActionDto {
  @ApiProperty({
    example: 'favorite',
    enum: ['favorite', 'unfavorite', 'download', 'remove_download'],
  })
  @IsString()
  @IsIn(['favorite', 'unfavorite', 'download', 'remove_download'])
  action: 'favorite' | 'unfavorite' | 'download' | 'remove_download';
}
