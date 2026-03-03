import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class UserCouponCodeDto {
  @ApiProperty({ example: 'SUMMER25', description: 'Coupon code to validate or redeem' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'Coupon code must contain only uppercase letters, numbers, hyphens, and underscores' })
  code: string;
}
