import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const REQUEST_ID_HEADER = 'x-request-id';

export function getRequestId(req: Request): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const existing = Array.isArray(header) ? header[0] : header;
  return typeof existing === 'string' && existing.length > 0 && existing.length <= 128
    ? existing
    : randomUUID();
}

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = getRequestId(req);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    return next.handle().pipe(
      map((body) => {
        if (body === undefined || body === null) {
          return { data: null, meta: { requestId } };
        }
        // Services that already shaped a full envelope (e.g. paginated lists) pass through.
        if (
          typeof body === 'object' &&
          'data' in (body as Record<string, unknown>) &&
          'meta' in (body as Record<string, unknown>)
        ) {
          const meta = (body as { meta: Record<string, unknown> }).meta;
          if (!('requestId' in meta)) {
            return { ...body, meta: { ...meta, requestId } };
          }
          return body;
        }
        return { data: body, meta: { requestId } };
      }),
    );
  }
}
