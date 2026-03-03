import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAdminTicketDto {
  @ApiPropertyOptional({
    description: 'User ID to create ticket on behalf of (omit for admin own)',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ description: 'Ticket subject' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ description: 'Ticket message' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
