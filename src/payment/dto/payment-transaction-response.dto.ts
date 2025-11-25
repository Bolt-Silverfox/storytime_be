import { ApiProperty } from '@nestjs/swagger';

export class PaymentTransactionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() status: string;
  @ApiProperty() reference?: string;
  @ApiProperty() createdAt: Date;
}
