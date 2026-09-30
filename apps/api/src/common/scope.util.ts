import { AuthorizationError } from './errors.js';
import type { RequestPrincipal } from './request-context.js';

/**
 * Central scope resolution (CLAUDE.md §9, §61; ARCHITECTURE.md §14).
 * Every organization-scoped query MUST pass through here — modules must not
 * invent their own filtering.
 */

export interface ScopeFilter {
  companyId?: { in: string[] };
  branchId?: { in: string[] };
}

export function buildScopeFilter(principal: RequestPrincipal): ScopeFilter {
  const filter: ScopeFilter = {};
  if (principal.companyIds !== null) {
    if (principal.companyIds.length === 0) {
      throw new AuthorizationError('User has no company scope assigned');
    }
    filter.companyId = { in: principal.companyIds };
  }
  if (principal.branchIds !== null) {
    if (principal.branchIds.length === 0) {
      throw new AuthorizationError('User has no branch scope assigned');
    }
    filter.branchId = { in: principal.branchIds };
  }
  return filter;
}

/**
 * Verifies a target record's organization fields fall inside the principal's
 * scope. Use before returning/fetching a single record by ID (IDOR/BOLA guard).
 */
export function assertRecordInScope(
  record: { companyId?: string | null; branchId?: string | null } | null | undefined,
  principal: RequestPrincipal,
  resourceLabel = 'record',
): void {
  if (!record) {
    return; // existence is handled by callers via NotFoundError
  }
  if (principal.companyIds !== null) {
    if (!record.companyId || !principal.companyIds.includes(record.companyId)) {
      throw new AuthorizationError(`You do not have permission to access this ${resourceLabel}`);
    }
  }
  if (principal.branchIds !== null && record.branchId !== null && record.branchId !== undefined) {
    if (!principal.branchIds.includes(record.branchId)) {
      throw new AuthorizationError(`You do not have permission to access this ${resourceLabel}`);
    }
  }
}

export function canAccessCompany(principal: RequestPrincipal, companyId: string): boolean {
  return principal.companyIds === null || principal.companyIds.includes(companyId);
}
