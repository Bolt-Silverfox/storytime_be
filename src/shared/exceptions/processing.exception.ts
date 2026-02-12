import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception';

// ==================== PROCESSING EXCEPTIONS ====================

export class ProcessingException extends DomainException {
    constructor(message: string, details?: Record<string, unknown>) {
        super(
            'PROCESSING_ERROR',
            message,
            HttpStatus.INTERNAL_SERVER_ERROR,
            details,
        );
    }
}

export class NonRetryableProcessingException extends DomainException {
    constructor(message: string, details?: Record<string, unknown>) {
        super(
            'PROCESSING_NON_RETRYABLE',
            message,
            HttpStatus.UNPROCESSABLE_ENTITY,
            details,
        );
    }
}

export class StoryGenerationException extends ProcessingException {
    constructor(message: string, details?: Record<string, unknown>) {
        super(`Story Generation Failed: ${message}`, details);
    }
}

export class EmailDeliveryException extends ProcessingException {
    constructor(recipient: string, message: string) {
        super(`Failed to send email to ${recipient}: ${message}`, { recipient });
    }
}
