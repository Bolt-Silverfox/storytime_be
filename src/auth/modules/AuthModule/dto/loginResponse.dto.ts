import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../UserModule/dto/user.dto';

export class LoginResponseDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ example: 's' })
  jwt: string;

  @ApiProperty({ example: 'refreshtoken' })
  refreshToken: string;
}
