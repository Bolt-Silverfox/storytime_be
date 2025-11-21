import { ApiProperty } from '@nestjs/swagger';


// Interface for a standardized successful API response body.

export class SuccessResponse<T> {
    @ApiProperty({ example: 200, description: 'The HTTP status code.' })
    statusCode: number;

    @ApiProperty({ example: true, description: 'Indicates the request was successful.' })
    success: boolean;

    @ApiProperty({ description: 'The actual response data.' })
    data: T;

    @ApiProperty({ example: 'Request completed successfully.', description: 'A short message describing the result.' })
    message?: string;

    constructor(statusCode: number, data: T, message?: string) {
        this.statusCode = statusCode;
        this.success = true;
        this.data = data;
        this.message = message;
    }
}


// Interface for a standardized error API response body

export class ErrorResponse {
    @ApiProperty({ example: 400, description: 'The HTTP status code.' })
    statusCode: number;

    @ApiProperty({ example: false, description: 'Indicates the request failed.' })
    success: boolean;

    @ApiProperty({ example: 'Bad Request', description: 'The error type or title.' })
    error: string;

    @ApiProperty({
        example: 'Validation failed.',
        description: 'A detailed message describing the error. Can be a string or an array of error strings.'
    })
    message: string | string[];

    @ApiProperty({ example: '1701234567890', description: 'A timestamp of when the error occurred.' })
    timestamp: string;

    @ApiProperty({ example: '/api/v1/auth/login', description: 'The path of the request that failed.' })
    path: string;

    constructor(statusCode: number, error: string, message: string | string[], path: string) {
        this.statusCode = statusCode;
        this.success = false;
        this.error = error;
        this.message = message;
        this.path = path;
        this.timestamp = new Date().toISOString();
    }
}