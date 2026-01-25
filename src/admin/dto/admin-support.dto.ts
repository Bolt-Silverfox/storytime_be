import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSupportTicketDto {
    @ApiProperty({
        description: 'Status of the ticket',
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        example: 'resolved',
        required: false,
    })
    @IsOptional()
    @IsEnum(['open', 'in_progress', 'resolved', 'closed'])
    status?: string;

    @ApiProperty({
        description: 'Admin notes or internal comments',
        example: 'User was contacted via email and issue is resolved.',
        required: false,
    })
    @IsOptional()
    @IsString()
    message?: string; 
}

export class SupportTicketFilterDto {
    @ApiProperty({ required: false, enum: ['open', 'in_progress', 'resolved', 'closed'] })
    @IsOptional()
    @IsEnum(['open', 'in_progress', 'resolved', 'closed'])
    status?: string;

    @ApiProperty({ required: false, description: 'Filter by User ID' })
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiProperty({ required: false, default: 1 })
    @IsOptional()
    page?: number;

    @ApiProperty({ required: false, default: 10 })
    @IsOptional()
    limit?: number;
}
