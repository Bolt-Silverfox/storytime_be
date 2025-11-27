import { ApiProperty } from '@nestjs/swagger';

export class ProgressItemDto {
  @ApiProperty()
  storyId: string;

  @ApiProperty()
  progress: number;

  @ApiProperty()
  completed: boolean;

  @ApiProperty()
  lastAccessed: Date;

  @ApiProperty({ required: false })
  story?: any;
}

export class ProgressListResponseDto {
  @ApiProperty({ type: [ProgressItemDto] })
  items: ProgressItemDto[];

  @ApiProperty()
  total: number;
}
