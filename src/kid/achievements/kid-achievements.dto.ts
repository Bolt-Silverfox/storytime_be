import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsNumber } from 'class-validator';

export class KidAchievementDto {
  @ApiProperty({ example: 'first_story' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'First Story Completed' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Complete a story for the first time' })
  @IsString()
  description: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  earned: boolean;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsOptional()
  progress?: number;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @IsOptional()
  target?: number;
}

export class KidAchievementsResponseDto {
  @ApiProperty({ type: [KidAchievementDto] })
  achievements: KidAchievementDto[];
}
