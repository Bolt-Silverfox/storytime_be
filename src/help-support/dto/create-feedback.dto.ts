import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateFeedbackDto {
  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  fullname: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Feedback about the new feature', required: false })
  @IsString()
  subject?: string;

  @ApiProperty({ example: 'I love the app! But add dark mode.' })
  @IsNotEmpty()
  @IsString()
  message: string;
}
