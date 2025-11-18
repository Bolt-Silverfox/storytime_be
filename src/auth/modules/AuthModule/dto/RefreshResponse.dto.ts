import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../UserModule/dto/user.dto';

export class RefreshResponseDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ example: 'token' })
  jwt: string;
}
