import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class VerifyPurchaseDto {
  @ApiProperty({
    example: 'google',
    description: 'Platform where the purchase was made',
    enum: ['google', 'apple'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['google', 'apple'])
  platform: 'google' | 'apple';

  @ApiProperty({
    example: 'com.storytime.monthly',
    description: 'Product ID of the purchased item',
  })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({
    example: 'token-from-google-play-or-app-store',
    description: 'Purchase token from the platform',
  })
  @IsString()
  @IsNotEmpty()
  purchaseToken: string;

  @ApiProperty({
    required: false,
    example: 'com.storytime.app',
    description: 'Package name (Android) - defaults to configured value',
  })
  @IsString()
  @IsOptional()
  packageName?: string;
}
