import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() type: string;
  @ApiProperty({ required: false }) provider?: string;
  @ApiProperty({ required: false }) last4?: string;
  @ApiProperty({ required: false }) expiry?: string;
  @ApiProperty() createdAt: Date;
}
