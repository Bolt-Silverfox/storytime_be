import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateKidDownloadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  kidId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  storyId: string;
}

