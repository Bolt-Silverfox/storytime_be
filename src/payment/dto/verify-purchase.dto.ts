import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum IapPlatform {
    ANDROID = 'android',
    IOS = 'ios',
}

export class VerifyPurchaseDto {
    @ApiProperty({ enum: IapPlatform, description: 'Platform where the purchase was made' })
    @IsEnum(IapPlatform)
    @IsNotEmpty()
    platform: IapPlatform;

    @ApiProperty({ description: 'The product ID (plan ID) purchased' })
    @IsString()
    @IsNotEmpty()
    productId: string;

    @ApiProperty({ description: 'Receipt data (iOS) or Purchase Token (Android)' })
    @IsString()
    @IsNotEmpty()
    receipt: string;

}
