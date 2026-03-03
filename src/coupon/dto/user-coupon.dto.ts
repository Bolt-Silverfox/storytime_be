import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UserCouponCodeDto {
  @ApiProperty({ example: 'SUMMER25', description: 'Coupon code to validate or redeem' })
  @IsString()
  @IsNotEmpty()
  code: string;
}
