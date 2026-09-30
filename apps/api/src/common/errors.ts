/**
 * Domain error taxonomy (CLAUDE.md §48, ARCHITECTURE.md §39).
 * The global exception filter maps these to safe HTTP responses.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_ERROR'
  | 'PERIOD_CLOSED'
  | 'INSUFFICIENT_STOCK'
  | 'APPROVAL_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly httpStatus = 400;
}

export class AuthenticationError extends DomainError {
  readonly code = 'AUTHENTICATION_ERROR' as const;
  readonly httpStatus = 401;
}

export class AuthorizationError extends DomainError {
  readonly code = 'AUTHORIZATION_ERROR' as const;
  readonly httpStatus = 403;
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  readonly httpStatus = 404;
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
  readonly httpStatus = 409;
}

export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE_ERROR' as const;
  readonly httpStatus = 422;
}

export class PeriodClosedError extends DomainError {
  readonly code = 'PERIOD_CLOSED' as const;
  readonly httpStatus = 422;
}

export class InsufficientStockError extends DomainError {
  readonly code = 'INSUFFICIENT_STOCK' as const;
  readonly httpStatus = 422;
}

export class ApprovalRequiredError extends DomainError {
  readonly code = 'APPROVAL_REQUIRED' as const;
  readonly httpStatus = 422;
}
