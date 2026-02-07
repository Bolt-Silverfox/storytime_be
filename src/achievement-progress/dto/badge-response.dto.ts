import { ApiProperty } from '@nestjs/swagger';

export class BadgePreviewDto {
    @ApiProperty()
    badgeId: string;

    @ApiProperty()
    title: string;

    @ApiProperty({ required: false })
    iconUrl: string | null;
    @ApiProperty()
    locked: boolean;

    @ApiProperty()
    count: number;
}

export class BadgeDetailDto {
    @ApiProperty()
    badgeId: string;

    @ApiProperty()
    title: string;

    @ApiProperty({ required: false })
    description: string | null;

    @ApiProperty({ required: false })
    iconUrl: string | null;
    @ApiProperty()
    locked: boolean;

    @ApiProperty()
    count: number;

    @ApiProperty()
    unlockCondition: string | null;
    @ApiProperty({ required: false })
    unlockedAt: Date | null;
}

export class FullBadgeListResponseDto {
    @ApiProperty({ type: [BadgeDetailDto] })
    badges: BadgeDetailDto[];
}
