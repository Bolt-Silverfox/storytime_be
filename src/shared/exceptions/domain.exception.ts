import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for all domain-specific exceptions.
 * Provides consistent error structure with codes for client-side handling.
 */
export abstract class DomainException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

// ==================== AUTHENTICATION EXCEPTIONS ====================

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super(
      'AUTH_TOKEN_EXPIRED',
      'Authentication token has expired',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class EmailNotVerifiedException extends DomainException {
  constructor() {
    super(
      'AUTH_EMAIL_NOT_VERIFIED',
      'Email not verified. Please check your inbox.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class InvalidTokenException extends DomainException {
  constructor(tokenType: string = 'token') {
    super(
      'AUTH_INVALID_TOKEN',
      `Invalid ${tokenType}`,
      HttpStatus.UNAUTHORIZED,
      { tokenType },
    );
  }
}

export class InvalidAdminSecretException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_ADMIN_SECRET',
      'Invalid admin secret',
      HttpStatus.FORBIDDEN,
    );
  }
}

// ==================== RESOURCE EXCEPTIONS ====================

export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, id?: string) {
    super(
      'RESOURCE_NOT_FOUND',
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      HttpStatus.NOT_FOUND,
      { resource, id },
    );
  }
}

export class ResourceAlreadyExistsException extends DomainException {
  constructor(resource: string, field: string, value: string) {
    super(
      'RESOURCE_ALREADY_EXISTS',
      `${resource} with ${field} "${value}" already exists`,
      HttpStatus.CONFLICT,
      { resource, field, value },
    );
  }
}

// ==================== BUSINESS LOGIC EXCEPTIONS ====================

export class QuotaExceededException extends DomainException {
  constructor(quotaType: string, limit: number) {
    super(
      'QUOTA_EXCEEDED',
      `${quotaType} quota exceeded. Limit: ${limit}`,
      HttpStatus.TOO_MANY_REQUESTS,
      { quotaType, limit },
    );
  }
}

export class SubscriptionRequiredException extends DomainException {
  constructor(feature: string) {
    super(
      'SUBSCRIPTION_REQUIRED',
      `Premium subscription required for ${feature}`,
      HttpStatus.PAYMENT_REQUIRED,
      { feature },
    );
  }
}

export class InvalidRoleException extends DomainException {
  constructor(role: string) {
    super('INVALID_ROLE', `Invalid role: ${role}`, HttpStatus.BAD_REQUEST, {
      role,
    });
  }
}

// ==================== VALIDATION EXCEPTIONS ====================

export class ValidationException extends DomainException {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, details);
  }
}
