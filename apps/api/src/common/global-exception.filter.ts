import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';
import { DomainError } from './errors.js';
import { getRequestId } from './api-envelope.interceptor.js';

/**
 * Central error mapping. Production clients only ever see safe, machine-readable
 * errors; diagnostics stay in server logs (CLAUDE.md §20, §47, §48).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = getRequestId(req);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof DomainError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      // Controller-level schema validation: a rejected request body is a
      // client error, not an internal failure (CLAUDE.md §48).
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = {
        issues: exception.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object') {
        const asObject = body as Record<string, unknown>;
        code = typeof asObject['code'] === 'string' ? asObject['code'] : mapHttpStatus(status);
        message = typeof asObject['message'] === 'string' ? asObject['message'] : exception.message;
        if (Array.isArray(asObject['message'])) {
          code = 'VALIDATION_ERROR';
          message = 'Request validation failed';
          details = { issues: asObject['message'] };
        }
      }
    } else {
      // Never leak internals to clients; log them server-side instead.
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    res.status(status).json({
      success: false,
      code,
      message,
      ...(details ? { details } : {}),
      meta: { requestId },
    });
  }
}

function mapHttpStatus(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'AUTHENTICATION_ERROR';
    case 403:
      return 'AUTHORIZATION_ERROR';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}
