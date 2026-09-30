import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionSet } from '@erp/permissions';
import { AuthorizationError } from '../common/errors.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

export const PERMISSIONS_KEY = 'erp:permissions';
export const REQUIRE_ANY = 'erp:permissions-any';

/**
 * Declares required permission keys. The endpoint passes when the principal
 * holds ANY of the keys (use `@RequirePermissions(..., { mode: 'all' })` for ALL).
 */
export const RequirePermissions = (
  ...args: Array<string | { mode?: 'any' | 'all' }>
): MethodDecorator & ClassDecorator => {
  const keys = args.filter((a): a is string => typeof a === 'string');
  let mode: 'any' | 'all' = 'any';
  for (const arg of args) {
    if (typeof arg === 'object' && arg.mode === 'all') {
      mode = 'all';
    }
  }
  return SetMetadata(PERMISSIONS_KEY, { keys, mode });
};

export interface DecodedPrincipal extends RequestPrincipal {
  isSuperAdmin: boolean;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { principal?: DecodedPrincipal }>();
    const principal = request.principal;
    if (!principal) {
      throw new AuthorizationError('Authentication required');
    }

    // Super administrators bypass permission checks but never scope checks.
    if (principal.isSuperAdmin) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<
      { keys: string[]; mode: 'any' | 'all' } | undefined
    >([PERMISSIONS_KEY], [context.getHandler(), context.getClass()]);

    if (!required || required.keys.length === 0) {
      return true; // endpoint only requires authentication
    }

    const permissionSet = new PermissionSet(principal.permissions);
    const ok =
      required.mode === 'all'
        ? permissionSet.hasAll(required.keys)
        : permissionSet.hasAny(required.keys);
    if (!ok) {
      throw new AuthorizationError('You do not have permission to perform this action');
    }
    return true;
  }
}
