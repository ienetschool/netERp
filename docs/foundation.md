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
| Approvals UI | Real approval inbox: approve / reject (reason required) / cancel, role- and user-based task assignment |
| Seed | Idempotent: 17 permission modules × actions, 18 roles, demo org (DEMO / HQ / GEN / MAIN warehouses), financial period, 11 accounts, admin@demo.local + manager@demo.local (`Admin123!`) |

## Stage 2 — Core Platform additions (implemented)

Per the PRD stage plan (Stage 2 = workflow engine, event engine, notification engine,
numbering, attachments, global search, settings, approval inbox) — the latter four
shipped with Stage 1, so this slice completed the remainder:

- **Workflow engine** (`apps/api/src/workflow/workflow-engine.service.ts`): versioned
  definitions with company overrides, instance lifecycle, guarded transitions — a
  transition whose `condition` JSON declares `{ approverType, approverId }` creates a
  PENDING ApprovalTask and blocks further transitions until decided.
- **Approval inbox** (`/workflow/approval-tasks`, web `/approvals`): user- and role-
addressed tasks; approve advances through the state's `approve` transition (or
  completes the instance), reject requires a reason and ends the instance, cancel
  aborts it. All decisions audited and emitted on the outbox
  (`workflow.instance.started`, `workflow.approval.acted`).
- **Settings engine** (`SystemSetting`, `/settings`): typed key/value store
  (string/number/boolean/json) with platform-level rows (companyId NULL) and
  per-company override precedence; read for any authenticated principal, writes gated
  by `settings.configuration.*` permissions; web admin page at `/admin/settings`.

## Money

`Money` (in `@erp/types`, decimal.js) is the single currency primitive; largest-remainder
allocation is covered by unit tests. All persistence is numeric/decimal — floats never
carry money.

## Testing & gates

- 47 unit tests passing (types, permissions, validation, api scope + numbering + workflow, web, worker).
- Playwright e2e configured (`apps/web/e2e/login.spec.ts`) but browsers not installed in this environment; run when a stack is up.
- Gates: `typecheck`, `lint`, `test:unit`, `build` all green per workspace; CI (`.github/workflows/ci.yml`) replays migration + seed against a Postgres service.

## Deliberate deferrals (later stages)

1. Accounting ledger beyond the chart-of-accounts seed (later PRD stage).
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
