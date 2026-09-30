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
- **Seeded demo workflow** (`purchase_request`): DRAFT → PENDING_APPROVAL →
  APPROVED / REJECTED; arriving at PENDING_APPROVAL tasks the BRANCH_MANAGER
  role (held by manager@demo.local), so the inbox is exercisable right after
  `db:seed`. See [ADR-0007](adr/0007-workflow-engine.md).

## Money

`Money` (in `@erp/types`, decimal.js) is the single currency primitive; largest-remainder
allocation is covered by unit tests. All persistence is numeric/decimal — floats never
carry money.

## Testing & gates

- 47 unit tests passing (types, permissions, validation, api scope + numbering + workflow, web, worker).
- Playwright e2e configured (`apps/web/e2e/login.spec.ts`) but browsers not installed in this environment; run when a stack is up.
- Gates: `typecheck`, `lint`, `test:unit`, `build` all green per workspace; CI (`.github/workflows/ci.yml`) replays migration + seed against a Postgres service.

## Stage 3 — HR (implemented)

Per the PRD stage plan (Stage 3 = employees, attendance, leave, holidays, calendar):

- **Employees** (`Employee`, `/hr/employees`): full demographic + employment record
  per DATA-MODEL §6, manager hierarchy, lifecycle status
  (DRAFT → ACTIVE → ON_LEAVE / SUSPENDED → TERMINATED / RETIRED), company-scoped
  listing and 404-on-out-of-scope reads.
- **Attendance** (`Attendance`, `/hr/attendance`): per-employee/per-day upsert with
  status taxonomy and clock in/out + worked/overtime minutes; raw device-event
  capture deferred (DATA-MODEL §7 keeps them separate).
- **Leave** (`LeaveType`, `LeaveRequest`, `/hr/leave`): create → submit; submitting
  starts a `leave_request` workflow instance and advances it through the
  definition's `submit` action, so the approver declared on that transition gets an
  inbox task automatically. Workflow terminal outcomes bridge back via
  `applyWorkflowOutcome` (wired for APPROVED/REJECTED).
- **Holidays** (`Holiday`, `/hr/holidays`): company/branch holidays by year.
- Seed: 3 demo employees, AL/SL/UPL leave types, 2 holidays, a `leave_request`
  workflow routed to BRANCH_MANAGER, and one PENDING_APPROVAL leave request ready
  in the manager inbox.
- **Workflow→entity bridge**: acting on an approval task applies the outcome to
  the owning entity (`WorkflowController.act` dispatches on the instance's
  `entityType`; COMPLETED→APPROVED, REJECTED/CANCELLED pass through,
  IN_PROGRESS intermediate approvals keep the entity pending).

## Stage 4 — Payroll (implemented)

Per the PRD stage plan (Stage 4 = pay groups, salary structures, payroll engine,
payslips, accounting integration):

- **Configuration** (`PayGroup`, `SalaryStructure`, `SalaryComponent`,
  `/payroll/pay-groups`, `/payroll/salary-structures`): pay frequency + currency
  + pay-day rule per company; component types EARNING / DEDUCTION /
  EMPLOYER_CONTRIBUTION with FLAT or PERCENT_OF_BASE calculation. No statutory
  tax engine is invented (CLAUDE.md §43) — tax lines are ordinary components.
- **Salary assignments** (`EmployeeSalaryAssignment`): effective-dated; assigning
  closes the previous ACTIVE record (SUPERSEDED) rather than overwriting history
  (CLAUDE.md §44). One ACTIVE open-ended assignment per employee.
- **Payroll engine** (`PayrollRun`/`PayrollEntry`/`PayrollLine`,
  `/payroll/runs`): calculate a period for a pay group — eligible employees
  (ACTIVE + assigned to the pay group + an effective assignment covering the
  period and matching the run currency), one entry per employee with one line
  per component. All arithmetic goes through `Money` (decimal strings; the
  percentage factor is produced by exact decimal-point shifting, unit-tested);
  every line is rounded HALF_UP at 2 dp and entries are asserted to reconcile
  to their lines before persisting. Employees that cannot be calculated are
  stored on the run as `exceptions` (UI-UX §24 Exceptions tab).
- **Approval**: submitting a CALCULATED run starts a `payroll_run` workflow and
  routes to the FINANCE_MANAGER role (USER-FLOWS §27); the workflow→entity
  bridge applies COMPLETED→APPROVED, REJECTED→back to CALCULATED (for
  correction and resubmission), CANCELLED→CANCELLED. Direct permission-gated
  approval is available when no workflow definition exists.
- **Accounting integration**: posting an APPROVED run validates an open
  financial period covering the payment date and emits a **balanced journal
  payload** on the outbox (`payroll.run.posted`): Dr salaries expense (gross) +
  employer cost, Cr net pay + deductions payable (default accounts 5100/2200,
  component account overrides respected per line). Debits always equal credits
  by construction (net = gross − deductions), satisfying USER-FLOWS §28.8.
  The Journal model itself lands with the accounting vertical slice, which will
  consume this event — until then no GL rows are written.
- **Payslips**: run detail page lists per-employee entries with gross,
  deductions, net and employer cost, plus expandable per-component payslip
  lines.
- Seed: "Monthly Staff" pay group, "Standard Staff" structure (BASIC 100%,
  HOUSING 25%, TRANSPORT flat 150, PENSION_EE 5% deduction, PENSION_ER 10%
  employer contribution), assignments for the demo employees, a `payroll_run`
  workflow routed to FINANCE_MANAGER, and a `finance@demo.local` demo user.

## Deliberate deferrals (later stages)

1. Accounting ledger beyond the chart-of-accounts seed (later PRD stage) — the
   payroll `payroll.run.posted` outbox event already carries the balanced
   journal payload for that slice to persist.
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
