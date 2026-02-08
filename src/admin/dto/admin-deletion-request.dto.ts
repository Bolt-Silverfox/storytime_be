import { ApiProperty } from '@nestjs/swagger';

export class DeletionRequestDto {
  @ApiProperty({ example: 'ticket-123' })
  id: string;

  @ApiProperty({ example: 'user-456' })
  userId: string;

  @ApiProperty({ example: 'user@example.com' })
  userEmail: string;

  @ApiProperty({ example: 'John Doe' })
  userName: string;

  @ApiProperty({ example: ['Too expensive', 'Found better app'] })
  reasons: string[];

  @ApiProperty({ example: 'I really liked the stories but...' })
  notes: string;

  @ApiProperty({ example: '2023-10-15T10:30:00Z' })
  createdAt: Date;

  @ApiProperty({ example: 'open' })
  status: string;

  @ApiProperty({ example: true })
  isPermanent: boolean;
}
