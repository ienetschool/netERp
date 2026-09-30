import { randomUUID } from 'crypto';
import type { Request } from 'express';

export interface RequestPrincipal {
  userId: string;
  email: string;
  permissions: string[];
  companyIds: string[] | null;
  branchIds: string[] | null;
  departmentIds: string[] | null;
  warehouseIds: string[] | null;
}

export interface RequestContext {
  requestId: string;
  principal?: RequestPrincipal;
}

declare module 'express-serve-static-core' {
  interface Request {
    context?: RequestContext;
    principal?: RequestPrincipal & { isSuperAdmin?: boolean };
  }
}

export function createRequestContext(req: Request): RequestContext {
  if (!req.context) {
    req.context = { requestId: randomUUID() };
  }
  return req.context;
}
