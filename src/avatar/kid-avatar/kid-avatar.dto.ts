import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateKidAvatarDto {
  @IsOptional()
  @IsUUID()
  avatarId?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

