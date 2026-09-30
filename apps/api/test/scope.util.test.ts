import { describe, expect, it } from 'vitest';
import {
  assertRecordInScope,
  buildScopeFilter,
  canAccessCompany,
} from '../src/common/scope.util.js';
import { AuthorizationError } from '../src/common/errors.js';

const platformPrincipal = {
  userId: 'u1',
  email: 'a@b.c',
  permissions: [],
  companyIds: null,
  branchIds: null,
  departmentIds: null,
  warehouseIds: null,
};

describe('buildScopeFilter', () => {
  it('returns no filter for platform scope', () => {
    expect(buildScopeFilter(platformPrincipal)).toEqual({});
  });

  it('constrains company and branch for scoped users', () => {
    const filter = buildScopeFilter({
      ...platformPrincipal,
      companyIds: ['c1'],
      branchIds: ['b1', 'b2'],
    });
    expect(filter).toEqual({ companyId: { in: ['c1'] }, branchId: { in: ['b1', 'b2'] } });
  });

  it('rejects empty scope instead of leaking data', () => {
    expect(() => buildScopeFilter({ ...platformPrincipal, companyIds: [] })).toThrow(
      AuthorizationError,
    );
  });
});

describe('assertRecordInScope', () => {
  it('passes for in-scope records', () => {
    expect(() => {
      assertRecordInScope(
        { companyId: 'c1', branchId: 'b1' },
        { ...platformPrincipal, companyIds: ['c1'] },
      );
    }).not.toThrow();
  });

  it('rejects cross-company access (IDOR/BOLA)', () => {
    expect(() => {
      assertRecordInScope(
        { companyId: 'c2', branchId: null },
        { ...platformPrincipal, companyIds: ['c1'] },
      );
    }).toThrow(AuthorizationError);
  });

  it('rejects cross-branch access', () => {
    expect(() => {
      assertRecordInScope(
        { companyId: 'c1', branchId: 'b9' },
        { ...platformPrincipal, companyIds: ['c1'], branchIds: ['b1'] },
      );
    }).toThrow(AuthorizationError);
  });

  it('platform scope passes any record', () => {
    expect(() => {
      assertRecordInScope({ companyId: 'zz', branchId: 'yy' }, platformPrincipal);
    }).not.toThrow();
  });
});

describe('canAccessCompany', () => {
  it('platform scope allows any company', () => {
    expect(canAccessCompany(platformPrincipal, 'anything')).toBe(true);
  });
  it('scoped principal is limited to their companies', () => {
    const p = { ...platformPrincipal, companyIds: ['c1'] };
    expect(canAccessCompany(p, 'c1')).toBe(true);
    expect(canAccessCompany(p, 'c2')).toBe(false);
  });
});
