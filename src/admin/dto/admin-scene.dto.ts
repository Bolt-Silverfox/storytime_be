import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SceneImageStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SceneDefinitionDto {
  @ApiProperty({ example: 0, description: '0-based first page (inclusive)' })
  @IsInt()
  @Min(0)
  startPage: number;

  @ApiProperty({ example: 2, description: '0-based last page (inclusive)' })
  @IsInt()
  @Min(0)
  endPage: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  styleNotes?: string;
}

export class ReplaceScenesDto {
  @ApiProperty({
    type: [SceneDefinitionDto],
    description:
      'Ordered scenes (sceneIndex = array position). Must start at page 0, be contiguous, non-overlapping and cover every page of the story.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SceneDefinitionDto)
  scenes: SceneDefinitionDto[];
}

export class UploadSceneImageDto {
  @ApiPropertyOptional({ example: 'gemini' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @ApiPropertyOptional({ example: 'gemini-2.5-flash-image' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;
}

export class ApproveSceneDto {
  @ApiProperty({
    description:
      'The imageUrl the reviewer was looking at. The approval is refused (409) if the scene image has changed since.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl: string;
}

export class RejectSceneDto {
  @ApiProperty({ example: 'Wrong character appearance' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;

  @ApiProperty({
    description:
      'The imageUrl the reviewer was looking at; refused (409) if it has changed since.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  imageUrl: string;
}

export class SceneReviewQueueQueryDto {
  @ApiPropertyOptional({
    enum: SceneImageStatus,
    default: SceneImageStatus.PENDING_REVIEW,
  })
  @IsOptional()
  @IsEnum(SceneImageStatus)
  status?: SceneImageStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
