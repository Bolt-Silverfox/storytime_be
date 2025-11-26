import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'Google ID Token received from Google Provider',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  idToken: string;
}
