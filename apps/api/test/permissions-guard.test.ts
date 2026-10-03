import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthorizationError } from '../src/common/errors.js';
import { PermissionsGuard, RequirePermissions } from '../src/iam/permissions.guard.js';
import type { DecodedPrincipal } from '../src/iam/permissions.guard.js';

function principal(overrides: Partial<DecodedPrincipal> = {}): DecodedPrincipal {
  return {
    userId: 'user-1',
    email: 'user@demo.local',
    permissions: [],
    companyIds: ['company-1'],
    branchIds: null,
    departmentIds: null,
    warehouseIds: null,
    isSuperAdmin: false,
    ...overrides,
  };
}

class Fixture {
  @RequirePermissions('reporting.report.view')
  anyOne(): void {}

  @RequirePermissions('identity.user.view', 'identity.role.view')
  anyOfTwo(): void {}

  @RequirePermissions({ mode: 'all' } as never, 'identity.user.view')
  allOf(): void {}

  open(): void {}
}

function contextFor(handler: (...args: never[]) => unknown, p: DecodedPrincipal): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ principal: p }) }),
    getHandler: () => handler,
    getClass: () => Fixture,
  } as unknown as ExecutionContext;
}

function guard(): PermissionsGuard {
  return new PermissionsGuard(new Reflector());
}

describe('PermissionsGuard', () => {
  // Regression: the guard once looked up `[PERMISSIONS_KEY]` (an array) instead
  // of `PERMISSIONS_KEY`, so `required` was always undefined and EVERY
  // @RequirePermissions in the application was unenforced.
  it('reads the decorator metadata instead of silently allowing', () => {
    const instance = new Fixture();
    expect(() =>
      guard().canActivate(contextFor(instance.anyOne as never, principal())),
    ).toThrow(AuthorizationError);
  });

  it('allows a principal holding the required permission', () => {
    const instance = new Fixture();
    expect(
      guard().canActivate(
        contextFor(
          instance.anyOne as never,
          principal({ permissions: ['reporting.report.view'] }),
        ),
      ),
    ).toBe(true);
  });

  it('honours wildcards through PermissionSet', () => {
    const instance = new Fixture();
    expect(
      guard().canActivate(
        contextFor(instance.anyOne as never, principal({ permissions: ['reporting.*'] })),
      ),
    ).toBe(true);
    expect(() =>
      guard().canActivate(
        contextFor(instance.anyOne as never, principal({ permissions: ['identity.*'] })),
      ),
    ).toThrow(AuthorizationError);
  });

  it('passes any-of semantics for multiple keys', () => {
    const instance = new Fixture();
    expect(
      guard().canActivate(
        contextFor(
          instance.anyOfTwo as never,
          principal({ permissions: ['identity.role.view'] }),
        ),
      ),
    ).toBe(true);
    expect(() =>
      guard().canActivate(
        contextFor(
          instance.anyOfTwo as never,
          principal({ permissions: ['accounting.journal.view'] }),
        ),
      ),
    ).toThrow(AuthorizationError);
  });

  it('lets a super administrator through without the permission', () => {
    const instance = new Fixture();
    expect(
      guard().canActivate(
        contextFor(instance.anyOne as never, principal({ isSuperAdmin: true })),
      ),
    ).toBe(true);
  });

  it('still allows an endpoint that declares no permissions', () => {
    const instance = new Fixture();
    expect(guard().canActivate(contextFor(instance.open as never, principal()))).toBe(true);
  });

  it('rejects a request with no principal', () => {
    const instance = new Fixture();
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => instance.anyOne,
      getClass: () => Fixture,
    } as unknown as ExecutionContext;
    expect(() => guard().canActivate(ctx)).toThrow(AuthorizationError);
  });
});