import { ApiProperty } from '@nestjs/swagger';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'App not working', description: 'Short subject' })
  subject: string;

  @ApiProperty({
    example: 'I cannot open the subscription screen',
    description: 'Detailed message',
  })
  message: string;
}
