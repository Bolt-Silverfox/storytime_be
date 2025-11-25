import { ApiProperty } from '@nestjs/swagger';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'Cannot play story', description: 'Short subject' })
  subject: string;

  @ApiProperty({ example: 'When I try to play story X it fails', description: 'Detailed message' })
  message: string;
}
