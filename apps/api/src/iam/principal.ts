/**
 * Role-assignment derivation, shared by token issuance (AuthService) and the
 * per-request guard (JwtAuthGuard).
 *
 * Permissions deliberately do NOT live in the access token: a full permission
 * set is ~30 KB, which blows past the 16 KB HTTP header cap that Node, most
 * proxies and CDNs enforce (requests then fail with 431). The guard resolves
 * them from the database instead, on the same query it already runs to check
 * account status — and that also means a revoked permission takes effect
 * immediately instead of when the token expires.
 */

/** The slice of a role assignment the derivation needs (structurally typed so
 * it accepts Prisma's nested query results without importing generated types). */
export interface RoleAssignmentGraph {
  companyId: string | null;
  branchId: string | null;
  departmentId: string | null;
  warehouseId: string | null;
  role: {
    code: string;
    permissions: Array<{ permission: { module: string; resource: string; action: string } }>;
  };
}

export interface ResolvedAccess {
  permissions: string[];
  companyIds: string[] | null;
  branchIds: string[] | null;
  departmentIds: string[] | null;
  warehouseIds: string[] | null;
  isSuperAdmin: boolean;
}

/** Derives permission keys and scope from a user's active role assignments. */
export function resolveAccess(assignments: RoleAssignmentGraph[]): ResolvedAccess {
  const permissionSet = new Set<string>();
  let isSuperAdmin = false;
  for (const assignment of assignments) {
    if (assignment.role.code === 'SUPER_ADMIN') isSuperAdmin = true;
    for (const rp of assignment.role.permissions) {
      permissionSet.add(
        `${rp.permission.module}.${rp.permission.resource}.${rp.permission.action}`,
      );
    }
  }

  // Scope: SUPER_ADMIN and unscoped assignments get platform-wide scope (null = all).
  const scopedAssignments = assignments.filter((a) => a.companyId !== null || a.branchId !== null);
  const isPlatformScope = isSuperAdmin || scopedAssignments.length === 0;

  return {
    permissions: [...permissionSet].sort(),
    companyIds: isPlatformScope
      ? null
      : [...new Set(scopedAssignments.map((a) => a.companyId as string))],
    branchIds: isPlatformScope
      ? null
      : [
          ...new Set(
            scopedAssignments.map((a) => a.branchId).filter((b): b is string => b !== null),
          ),
        ],
    departmentIds: isPlatformScope
      ? null
      : [
          ...new Set(
            scopedAssignments.map((a) => a.departmentId).filter((d): d is string => d !== null),
          ),
        ],
    warehouseIds: isPlatformScope
      ? null
      : [
          ...new Set(
            scopedAssignments.map((a) => a.warehouseId).filter((w): w is string => w !== null),
          ),
        ],
    isSuperAdmin,
  };
}
