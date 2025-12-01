import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({ example: 'supersecretpassword', description: 'Current user password to confirm deletion' })
  password: string;

  @ApiProperty({ type: [String], required: false, example: ['I do not like the app', 'Price too high'] })
  reasons?: string[];

  @ApiProperty({ required: false, example: 'Additional details' })
  notes?: string;
}
