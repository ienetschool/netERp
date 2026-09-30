# ADR-0003: String permissions with wildcard PermissionSet

**Status:** Accepted

## Context
The spec requires fine-grained authorization (`<module>.<resource>.<action>`) with
role hierarchies and platform-vs-org scoping, without a heavyweight policy engine.

## Decision
Represent permissions as strings (`module.resource.action`) evaluated by a
`PermissionSet` that supports `*`, `module.*`, and `module.resource.*` wildcards.
`SUPER_ADMIN` bypasses permission checks but **never** scope checks. Enforcement is a
global `PermissionsGuard` + `@RequirePermissions(...)` decorators.

## Consequences
- Permissions are seeded data (17 modules × actions), trivially extensible per tenant.
- Scope enforcement stays explicit and separate from permission checks.
- No dynamic policy expressions; complex rules become code in services when needed.
