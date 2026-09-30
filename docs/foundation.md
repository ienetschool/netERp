# Foundation notes — Stage 1 (Core Platform)

Status: **implemented** as a vertical slice. This document records what shipped,
what is deliberately deferred, and open decisions.

## Scope delivered

| Area | Implementation |
| --- | --- |
| Monorepo | npm workspaces: `apps/{web,api,worker}` + `packages/{types,permissions,validation,ui,prisma}` |
| Auth | Email/password (argon2), JWT access tokens, rotating refresh tokens with reuse detection (family revocation), 5-tries/15-min lockout, change-password |
| RBAC | `<module>.<resource>.<action>` permissions, `PermissionSet` with `*` / `module.*` / `module.resource.*` wildcards, 18 seeded system roles, SUPER_ADMIN bypasses permission checks but **not** scope checks |
| Org scope | Multi-company/branch scoping on principal; `scope.util` filters queries; `companyIds/branchIds = null` means platform-wide |
| Audit | `AuditService` writes `AuditLog` for all mutating admin/document operations; `GET /audit` with pagination + filters |
| Documents | Upload (20 MB cap, MIME checks), versioning, links, authorization-checked download; storage drivers: S3 / local / memory (memory = local dev default) |
| Numbering | `PREFIX-YYYY-NNNNNN` via `NumberingService.nextDocumentNumber(tx, companyId, documentType)` using `pg_advisory_xact_lock`; must be called inside the caller's transaction |
| Notifications | Preference-checked notifications, delivery channels with PENDING external deliveries processed by the worker (email/sms/whatsapp adapters intentionally throw "not configured") |
| Outbox | Transactional outbox (`OutboxEvent` PENDING → worker relay → PUBLISHED / FAILED after 10 attempts), BullMQ queues with attempts:5 exponential backoff |
| Search | Scope-aware `SearchDocument` query endpoint (Postgres-backed; Meilisearch/Typesense deferred) |
| Dashboard shell | Permission-aware navigation, role-aware KPIs, alerts panel, breadcrumbs, collapsible sidebar, mobile drawer, skeletons/empty states |
| Health | Liveness + readiness (Postgres + Redis probes) |
| Approvals UI | Honest empty state — workflow engine data model exists (WorkflowDefinition/State/Transition/Instance/ApprovalTask), engine execution is a later stage |
| Seed | Idempotent: 17 permission modules × actions, 18 roles, demo org (DEMO / HQ / GEN / MAIN warehouses), financial period, 11 accounts, admin@demo.local + manager@demo.local (`Admin123!`) |

## Money

`Money` (in `@erp/types`, decimal.js) is the single currency primitive; largest-remainder
allocation is covered by unit tests. All persistence is numeric/decimal — floats never
carry money.

## Testing & gates

- 32 unit tests passing (types, permissions, validation, api scope + numbering, web, worker).
- Playwright e2e configured (`apps/web/e2e/login.spec.ts`) but browsers not installed in this environment; run when a stack is up.
- Gates: `typecheck`, `lint`, `test:unit`, `build` all green per workspace; CI (`.github/workflows/ci.yml`) replays migration + seed against a Postgres service.

## Deliberate deferrals (later stages)

1. Workflow engine execution (approvals inbox is a placeholder with honest empty state).
2. Accounting ledger beyond the chart-of-accounts seed (Stage 2 per PRD).
3. Procurement/Sales/Inventory modules (Stages 3–5).
4. External notification adapters (email/sms/whatsapp) — stubs throw until SMTP/provider creds exist.
5. Dedicated search engine; Redis caching layer in front of read endpoints.
6. Playwright browsers + full e2e run (needs running Postgres/Redis).

## Open decisions

1. **Production database target** — the deployment host in `docs/CLAUDE.md` §73 runs
   MariaDB; the architecture mandates PostgreSQL. Unresolved — see
   [`deployment-db-conflict.md`](deployment-db-conflict.md) and
   [ADR-0006](adr/0006-production-database-target.md).
2. Object storage for production (S3-compatible MinIO locally; target bucket/credentials TBD).
3. JWT secret management for non-dev environments (env vars today; vault/secrets manager later).
