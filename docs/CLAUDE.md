# CLAUDE.md

# Enterprise Office ERP — Claude Code Build Contract

**Status:** Project-level implementation contract  
**Version:** 1.0

This file is the operating contract for Claude Code and other AI coding agents working on this repository.

The ERP must be built as a production-grade, modular, secure, auditable business system. Do not treat the project as a collection of UI mockups or isolated CRUD screens.

---

## 1. Source-of-Truth Hierarchy

Use the project documents in this order:

```text
PRD.md
  ↓
ARCHITECTURE.md
  ↓
DATA-MODEL.md
  ↓
USER-FLOWS.md
  ↓
UI-UX.md
  ↓
CLAUDE.md
```

Interpretation:

- `PRD.md` defines product requirements.
- `ARCHITECTURE.md` defines system architecture and technical boundaries.
- `DATA-MODEL.md` defines domain entities and relationships.
- `USER-FLOWS.md` defines business workflows and lifecycle behavior.
- `UI-UX.md` defines interface and interaction requirements.
- `CLAUDE.md` defines how the coding agent must execute the implementation.

Do not silently replace a project rule with generic best practices.

If a requirement is genuinely unspecified, isolate the decision behind configuration or a domain-level abstraction and document the gap.

Do not invent financial formulas, approval thresholds, tax rules, statutory rates, retention periods, or business policies without source support.

---

# 2. Core Development Principle

Build vertically, not horizontally.

Correct:

```text
Database
→ Domain
→ Service
→ API
→ Authorization
→ Workflow
→ Accounting/Inventory/Event effects
→ UI
→ Tests
→ Documentation
```

Incorrect:

```text
Build all database tables
→ Build all APIs
→ Build all screens
→ connect everything later
```

Every completed feature must be executable end-to-end.

A screen is not a completed feature.

---

# 3. Required Implementation Order

Follow the project's vertical-slice sequence:

```text
1. Foundation
2. Core Platform
3. HR
4. Payroll
5. Procurement
6. Inventory
7. Sales
8. Accounting
9. Office
10. Communication
11. Reporting
12. Hardening
```

Do not move to the next unstable slice.

The architecture's delivery strategy is the authority for module ordering.

---

# 4. Foundation First

Before business modules, establish:

```text
repository structure
environment configuration
database connection
migrations
ORM/data access
authentication
authorization
organization scope
audit framework
file storage abstraction
event/outbox infrastructure
job queue
notification abstraction
logging
error handling
API conventions
frontend shell
design system
test infrastructure
CI checks
```

Initial acceptance must include:

```text
application starts
database connects
migrations run
authentication works
roles/permissions work
company/branch/department scope works
audit records work
file storage abstraction works
navigation works
dashboard shell works
safe seed data works
tests run
typecheck passes
lint passes
production build passes
```

---

# 5. Repository Discipline

Before modifying code:

```text
inspect repository
inspect package configuration
inspect environment examples
inspect migrations
inspect existing routes
inspect existing components
inspect tests
inspect project documentation
```

Do not overwrite existing working code blindly.

Prefer small, reviewable changes.

Do not create duplicate implementations of an existing shared service or component.

---

# 6. Package and Dependency Rules

Before adding a dependency:

1. Check whether the project already provides equivalent functionality.
2. Prefer existing approved dependencies.
3. Confirm compatibility with the architecture.
4. Avoid unnecessary packages.
5. Update the correct package manifest and lockfile.
6. Run installation/build/type checks.

Do not introduce a large framework merely to solve a small problem.

---

# 7. Environment and Secrets

Never commit:

```text
API keys
passwords
tokens
private keys
production credentials
database credentials
session secrets
webhook secrets
OAuth client secrets
```

Use environment variables.

Maintain safe examples such as:

```text
.env.example
```

Never print secrets into logs.

Do not expose server secrets to client bundles.

---

# 8. Security Is a Build Requirement

Security is not a later hardening task.

Always implement:

```text
server-side authorization
least privilege
organization scoping
input validation
secure authentication
secure sessions
rate limiting where required
audit logging
secure file access
safe error handling
IDOR/BOLA protection
```

The frontend may hide unauthorized actions for usability, but the backend must enforce every permission.

Never trust:

```text
client-supplied role
client-supplied company_id
client-supplied branch_id
client-supplied user_id
client-supplied permissions
hidden form fields
URL parameters
```

Validate authorization against the authenticated principal and permitted organization scope.

---

# 9. Multi-Company / Multi-Branch Scope

For every organization-scoped query:

```text
authenticated user
→ resolve authorized scope
→ apply server-side scope
→ query
```

Do not rely on:

```text
frontend filtering
```

A user must never retrieve another company's or branch's data by changing an identifier.

All relevant services and repositories must preserve scope.

---

# 10. Database Rules

Use migrations for schema changes.

Never manually alter production schema outside the migration process.

Schema changes require:

```text
migration
→ application compatibility
→ tests
→ rollback/forward strategy where appropriate
```

Use:

```text
foreign keys
unique constraints
check constraints where appropriate
indexes
timestamps
soft deletion where business rules require it
```

Do not add indexes blindly.

For large tables, consider query patterns before adding indexes.

---

# 11. Data Integrity

Database constraints are part of business correctness.

Examples:

```text
unique document numbers
valid foreign keys
valid status transitions where practical
positive quantities where required
non-negative balances where required
valid currency precision
journal balancing
organization consistency
```

Do not depend exclusively on frontend validation.

---

# 12. Transactions

Use database transactions for operations that must succeed or fail together.

Especially:

```text
financial posting
inventory movement
stock transfer
payment allocation
payroll posting
period close
number generation
critical workflow transitions
```

Never allow:

```text
inventory updated
but journal missing
```

or:

```text
payment created
but allocation partially missing
```

or:

```text
financial transaction posted
but audit/outbox state missing
```

where atomicity is required.

---

# 13. Financial Rules

Accounting is the financial backbone.

Every posting must have:

```text
source transaction
posting authority
valid financial period
valid accounts
valid dimensions
balanced debit/credit
traceable reference
audit history
```

Before posting:

```text
Validate source
→ Validate state
→ Validate permissions
→ Validate period
→ Validate accounts
→ Validate dimensions
→ Validate currency/tax where applicable
→ Validate balance
→ Post atomically
```

Posted financial records are historical records.

Do not silently edit posted accounting history.

Corrections use controlled mechanisms such as:

```text
reversal
credit/debit adjustment
corrective transaction
```

according to the project workflow.

---

# 14. Journal Invariant

For every posted journal:

```text
sum(debits) == sum(credits)
```

This must be enforced server-side and preferably at the domain/service layer before database commit.

Never trust browser-calculated totals.

---

# 15. Financial Periods

Before posting:

```text
period exists
period is open
user can post
```

Closed periods reject normal posting.

Period close must include configured validation checks and must be auditable.

Do not bypass period protection for convenience.

---

# 16. Inventory Rules

Inventory changes must be represented by traceable stock movements.

Examples:

```text
receipt
issue
transfer
adjustment
return
```

Do not directly mutate stock balances without the required movement record.

Inventory operations must preserve:

```text
item
quantity
warehouse
location
batch/serial where required
source document
actor
timestamp
valuation information where applicable
```

Concurrent stock changes require safe server-side handling.

---

# 17. Workflow Rules

Use explicit state machines.

Do not implement business workflow as scattered boolean flags.

Every transition should define:

```text
current state
target state
actor
permission
validation
side effects
audit event
notification
domain event
```

Reject invalid transitions server-side.

Common actions:

```text
Draft
Submit
Review
Approve
Reject
Return for Correction
Cancel
Post
Reverse
```

Not every entity needs every state.

---

# 18. Approval Rules

Approval configuration must remain configurable when thresholds or routing are not defined.

Support where required:

```text
sequential approval
parallel approval
amount-based approval
role-based approval
company routing
branch routing
department routing
cost-center routing
delegation
escalation
approval history
comments
due dates
notifications
```

Never hard-code an invented approval amount.

---

# 19. Workflow UX Rules

For a stateful record, UI actions must reflect the current state.

Example:

```text
DRAFT
→ Edit
→ Submit

SUBMITTED
→ Approve
→ Reject
→ Request Changes

APPROVED
→ Process

POSTED
→ View
→ Reverse if permitted
```

The UI is not the authorization boundary.

---

# 20. API Rules

APIs should be:

```text
resource-oriented
validated
authorized
scope-aware
paginated where needed
consistent in error format
auditable for sensitive operations
```

Use a consistent safe error structure, for example:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Human-readable message",
  "details": {}
}
```

Never return stack traces or secrets to production clients.

---

# 21. API Input Validation

Validate:

```text
types
required fields
formats
ranges
relationships
organization scope
business state
permissions
```

Use shared schemas where appropriate.

Client schemas improve UX; server schemas enforce correctness.

---

# 22. Idempotency

Idempotency is required for operations that may be retried.

Especially:

```text
payments
webhooks
external integration calls
scheduled jobs
notifications
document processing
financial posting requests
large exports
```

A retry must not create duplicate financial or business transactions.

---

# 23. Background Jobs

Use asynchronous jobs for:

```text
email
SMS
WhatsApp
large reports
PDF generation
large exports
notifications
scheduled reports
document processing
reminders
```

Jobs must record:

```text
job id
status
attempt
timestamps
error
```

Retry recoverable failures.

Do not endlessly retry permanent failures.

---

# 24. Outbox / Domain Events

For important committed business events:

```text
database transaction
+
outbox event
```

must be coordinated so the application does not report a business event that was never committed.

Examples:

```text
PurchaseOrderApproved
GoodsReceiptPosted
SupplierInvoicePosted
CustomerInvoicePosted
PaymentPosted
PayrollPosted
EmployeeTerminated
```

Event consumers must be safe to retry.

---

# 25. Notifications

Notifications should be event-driven where practical.

Support:

```text
in-app
email
SMS
WhatsApp adapter
```

Notification records should preserve delivery state.

Do not make external provider availability determine whether a core database transaction succeeds unless explicitly required.

---

# 26. External Integrations

Use adapters/interfaces.

Do not scatter provider-specific calls throughout business services.

Prefer:

```text
NotificationService
  → EmailProvider
  → SmsProvider
  → WhatsAppProvider
```

and:

```text
StorageService
  → LocalStorage
  → S3-compatible provider
```

This keeps business logic provider-independent.

---

# 27. File Handling

For uploaded files:

```text
validate type/size
→ security scanning where configured
→ store object
→ create metadata
→ calculate hash where appropriate
→ link to entity
→ audit
```

Never expose private files through predictable public URLs.

Authorization must be checked before download/preview.

---

# 28. Document Versioning

Documents that support versioning must preserve history.

Do not overwrite the only copy of a business document when the requirement calls for version history.

Store:

```text
document
version
metadata
actor
timestamp
```

---

# 29. Frontend Rules

Use:

```text
Next.js
React
TypeScript
Tailwind CSS
accessible component system
TanStack Query
React Hook Form
Zod
```

Follow the architecture's feature-based organization.

Avoid giant components.

Split by:

```text
feature
domain
responsibility
```

---

# 30. Frontend State

Use server-state tooling for server data.

Do not duplicate server state unnecessarily in global client stores.

Typical responsibilities:

```text
TanStack Query → server state
React Hook Form → form state
local React state → ephemeral UI state
```

Invalidate/refetch after mutations as appropriate.

---

# 31. Frontend Authorization

Hide or disable unavailable actions for usability.

But:

```text
server authorization always wins
```

If the API returns a permission failure, display a safe explanation.

Never infer that a hidden button means the operation is secure.

---

# 32. UI Consistency

Use shared components for:

```text
buttons
inputs
dialogs
tables
filters
badges
tabs
drawers
toasts
forms
empty states
error states
loading states
timelines
```

Do not create visually different versions of the same control without a documented reason.

---

# 33. UI States

Every significant page must consider:

```text
loading
empty
filtered-empty
success
validation error
server error
permission denied
not found
conflict
mobile
```

Never ship a page that only works in the happy path.

---

# 34. Tables

Large lists should use server-side:

```text
pagination
filtering
sorting
search
```

Do not download thousands of records merely to filter them in the browser.

Use reusable data-table patterns.

---

# 35. Forms

Forms must provide:

```text
labels
validation
server errors
submission state
duplicate-submit prevention
unsaved-change warning where appropriate
accessible error association
```

Use draft saving where the business workflow supports it.

---

# 36. Mobile

Prioritize mobile support for:

```text
approvals
notifications
attendance
leave
record lookup
critical workflow actions
```

Do not simply shrink desktop layouts.

Use mobile-specific layouts when information density requires it.

---

# 37. Accessibility

Every feature should maintain:

```text
keyboard navigation
visible focus
semantic HTML
accessible names
screen-reader-friendly errors
logical heading hierarchy
non-color status communication
dialog focus management
```

Accessibility defects are implementation defects.

---

# 38. Global Search

Search must be authorization-aware.

Never:

```text
search globally
then filter unauthorized records in UI
```

Instead:

```text
authenticated request
→ server authorization/scope
→ authorized search
→ response
```

---

# 39. Reporting

Financial reports must use authoritative posted accounting data when they represent financial statements or balances.

Support where specified:

```text
filters
date ranges
organization scope
drill-down
export
saved configurations
```

A report number must be traceable to underlying transactions.

---

# 40. Accounting Reconciliation

Maintain reconciliation paths for:

```text
AR
AP
inventory
payroll
bank/cash
general ledger
```

Where a feature creates both operational and financial data, tests should verify that the two sides reconcile.

---

# 41. Procurement Rules

Procure-to-pay must remain traceable:

```text
Purchase Request
→ RFQ
→ Supplier Quotation
→ Purchase Order
→ Goods Receipt
→ Supplier Invoice
→ Payment
```

Support three-way matching where required:

```text
PO
+
Goods Receipt
+
Supplier Invoice
```

Variance must become an explicit exception, not a silent mismatch.

---

# 42. Sales Rules

Quote-to-cash must remain traceable:

```text
Quotation
→ Sales Order
→ Delivery
→ Customer Invoice
→ Receipt
```

Inventory and financial effects must occur at their defined workflow stages.

---

# 43. Payroll Rules

Payroll must integrate:

```text
employee
attendance
leave
earnings
deductions
taxes
employer costs
accounting
payment
```

Payroll posting must reconcile payroll totals to accounting effects.

Never invent statutory tax calculations when the project does not define them.

Keep configurable tax/rule engines where needed.

---

# 44. HR Rules

Employee history must remain effective-dated where the domain requires historical tracking.

Transfers, compensation changes, department changes and employment status changes should preserve historical records rather than erasing previous assignments.

---

# 45. Fixed Asset Rules

Asset lifecycle:

```text
acquisition
→ capitalization
→ depreciation
→ transfer
→ disposal
```

Depreciation must be reproducible and idempotent.

Disposal must preserve historical acquisition/depreciation records and calculate configured accounting effects.

---

# 46. Audit Rules

Audit sensitive actions.

At minimum consider:

```text
authentication/security events
user changes
role/permission changes
employee changes
leave decisions
payroll
purchase approvals
PO approvals
goods receipts
inventory adjustments
supplier invoices
payments
sales approvals
deliveries
customer invoices
receipts
journal posting
reversals
period close
asset actions
document actions
exports
configuration changes
integrations
```

Audit entries should identify:

```text
actor
timestamp
action
resource
resource id
before/after where appropriate
correlation/request id
metadata
```

Do not expose sensitive audit information to unauthorized users.

---

# 47. Logging

Use structured logs.

Include safe operational fields such as:

```text
timestamp
level
service
request/correlation id
user id where safe
organization scope where safe
operation
duration
result
error code
```

Never log:

```text
passwords
tokens
private keys
full payment credentials
sensitive secrets
```

---

# 48. Error Handling

Use typed/domain errors.

Examples:

```text
ValidationError
AuthorizationError
NotFoundError
ConflictError
BusinessRuleError
PeriodClosedError
InsufficientStockError
ApprovalRequiredError
```

Map these to safe API responses.

Do not swallow errors.

Do not expose internal implementation details to users.

---

# 49. Concurrency

Protect high-contention operations.

Especially:

```text
stock balance
stock transfers
number sequences
payment allocation
payroll runs
period closing
financial posting
```

Use appropriate:

```text
database transactions
row locks
optimistic concurrency
unique constraints
idempotency
```

Do not assume single-user execution.

---

# 50. Numbering

Document numbers must be generated server-side.

Numbering may depend on:

```text
company
branch
document type
financial year
prefix
sequence
```

Use concurrency-safe generation.

Never generate official document numbers by incrementing a value in the browser.

---

# 51. Testing Pyramid

For each feature:

```text
Unit tests
→ Service/domain tests
→ API/integration tests
→ E2E tests
```

Prioritize business-critical behavior.

---

# 52. Mandatory Critical E2E Journeys

Maintain E2E coverage for:

```text
login
authorization
organization scope
procure-to-pay
quote-to-cash
hire-to-pay
asset lifecycle
approval workflow
financial posting
inventory movement
```

Add regression tests whenever a production bug is fixed.

---

# 53. Test Isolation

Tests must not depend on execution order.

Use controlled test data.

Avoid tests that silently use a developer's local credentials or production-like external services.

---

# 54. Type Safety

Do not use `any` as an escape hatch for normal application development.

If an external API is untyped:

```text
validate at boundary
→ convert to typed internal representation
```

Run type checking before declaring a feature complete.

---

# 55. Linting and Formatting

Before completion:

```text
lint
format/check
typecheck
tests
build
```

Do not silence lint/type errors without understanding the cause.

---

# 56. Build Gate

A feature is not done if:

```text
typecheck fails
lint fails
tests fail
production build fails
migration fails
```

Fix root causes.

Do not weaken checks merely to obtain a green build.

---

# 57. Git Discipline

Use small, meaningful commits.

Commit messages should describe the change.

Avoid committing:

```text
temporary files
logs
secrets
generated local databases
node_modules
build artifacts
debug dumps
```

Do not rewrite shared history unless explicitly requested.

---

# 58. Change Management

Before a large change:

```text
inspect existing implementation
identify affected modules
identify database impact
identify API impact
identify workflow impact
identify accounting/inventory impact
identify UI impact
identify tests
```

After the change:

```text
run relevant tests
run typecheck
run lint
run build
review diff
```

---

# 59. Do Not Fake Functionality

Never implement:

```text
fake API responses
hard-coded dashboard numbers
fake approvals
fake accounting entries
fake inventory quantities
fake success messages
placeholder business workflows
```

unless explicitly building a test fixture or prototype isolated from production behavior.

A button labeled "Post" must perform the actual controlled posting workflow when the feature is declared complete.

---

# 60. No Silent Business Logic

Do not bury important business rules inside:

```text
React components
SQL fragments
random utility functions
controller conditionals
```

Put domain rules in recognizable services/domain modules.

Make important rules testable.

---

# 61. No Duplicate Domain Logic

If a rule is shared:

```text
centralize it
```

Examples:

```text
permission resolution
organization scope
money calculations
tax abstraction
document numbering
workflow transition validation
status handling
```

Do not implement slightly different versions in different screens.

---

# 62. Documentation

When behavior changes:

```text
update relevant documentation
```

Document:

```text
new environment variables
new migrations
new APIs
new workflow states
new permissions
new jobs
new integration settings
```

Documentation must describe actual behavior.

---

# 63. Agent Workflow

For each task, follow:

```text
1. Read relevant source documents.
2. Inspect existing implementation.
3. Identify affected domain.
4. Plan the smallest coherent vertical slice.
5. Implement backend/domain first.
6. Add authorization and scope.
7. Add workflow/business effects.
8. Add audit/events.
9. Add frontend.
10. Add tests.
11. Run validation gates.
12. Review diff.
13. Update documentation.
14. Report exactly what changed.
```

Do not skip directly to step 9 for business-critical features.

---

# 64. Before Coding

Answer internally:

```text
What business capability is being implemented?
What source document defines it?
What entity/state machine is involved?
Who can perform it?
What organization scope applies?
What data changes?
What accounting/inventory effects occur?
What events/notifications occur?
What audit record is required?
What UI states are required?
What tests prove it works?
```

If any answer is unknown because the project does not define it, do not invent a consequential rule.

---

# 65. After Coding

Verify:

```text
database
domain
service
API
authorization
scope
workflow
events
audit
UI
tests
documentation
```

Then run:

```text
typecheck
lint
unit tests
integration tests
E2E where applicable
production build
```

---

# 66. Definition of Done

A module/feature is complete only when applicable:

```text
[ ] database schema
[ ] migration
[ ] domain model
[ ] service
[ ] API
[ ] validation
[ ] authorization
[ ] organization scope
[ ] workflow
[ ] accounting/inventory integration
[ ] audit
[ ] events/outbox
[ ] notifications
[ ] frontend
[ ] loading state
[ ] empty state
[ ] error state
[ ] responsive behavior
[ ] accessibility
[ ] tests
[ ] documentation
[ ] typecheck
[ ] lint
[ ] production build
```

Do not mark incomplete functionality as complete.

---

# 67. Production Readiness

Before calling the application production-ready, verify:

```text
security controls
authentication
authorization
scope isolation
database migrations
backup strategy
logging
audit
monitoring
error handling
rate limiting
file security
job retry behavior
idempotency
financial integrity
inventory integrity
reconciliation
E2E critical flows
build pipeline
environment configuration
secret management
documentation
```

---

# 68. AI Coding Behavior

Claude Code must:

```text
inspect before editing
reuse existing abstractions
follow project terminology
respect source documents
avoid speculative features
avoid unnecessary dependencies
prefer maintainable code
keep changes reviewable
test business logic
protect security boundaries
preserve historical financial data
```

Claude Code must not:

```text
invent requirements
bypass permissions
disable security
fake completed functionality
hard-code financial policy without source
delete historical accounting records
ignore failed tests
hide build errors
commit secrets
replace architecture without justification
```

---

# 69. When Requirements Conflict

Use this order:

```text
explicit current user requirement
→ PRD
→ architecture
→ data model
→ user flows
→ UI/UX
→ existing implementation
→ general engineering convention
```

If a conflict affects security, financial integrity or data integrity, stop and surface the conflict rather than silently choosing a risky interpretation.

---

# 70. When the User Requests a Shortcut

A shortcut is acceptable only if it does not violate:

```text
security
data integrity
financial integrity
authorization
auditability
architecture boundaries
```

Examples of unacceptable shortcuts:

```text
disable authorization temporarily
hard-code user role
skip migration
write directly to production data
fake posting
skip transaction boundaries
expose private files publicly
ignore failing tests
```

---

# 71. Final Agent Rule

Build the ERP as a real business system.

The target is:

```text
correct
secure
auditable
maintainable
testable
responsive
accessible
scalable
traceable
```

not merely:

```text
looks finished
```

Every important business action must have a trustworthy path from:

```text
user intent
→ authorized request
→ validated domain operation
→ durable data change
→ accounting/inventory effect where applicable
→ audit/event
→ notification where applicable
→ visible UI result
→ automated test
```

That chain is the core engineering standard for this project.

---

# 72. Final Project Checklist

Before declaring the ERP complete:

```text
[ ] PRD requirements implemented
[ ] Architecture boundaries respected
[ ] Data model implemented
[ ] User flows implemented
[ ] UI/UX requirements implemented
[ ] Authentication
[ ] RBAC
[ ] Organization scope
[ ] Audit
[ ] Document management
[ ] HR
[ ] Attendance
[ ] Leave
[ ] Payroll
[ ] Procurement
[ ] Inventory
[ ] Sales
[ ] Accounting
[ ] AR
[ ] AP
[ ] Fixed Assets
[ ] Office
[ ] Communication
[ ] Notifications
[ ] Reporting
[ ] Background jobs
[ ] Integrations
[ ] Security hardening
[ ] Performance checks
[ ] Accessibility checks
[ ] Critical E2E flows
[ ] Typecheck
[ ] Lint
[ ] Tests
[ ] Production build
[ ] Documentation
```

---

## END OF CLAUDE CODE CONTRACT


# 73. Deployment Environment — IENET ERP

The current deployment target for this ERP is:

```text
Application URL:
https://erp.ienet.online

Application path:
/var/www/vhosts/ienet.online/erp.ienet.online

Server:
76.13.98.31

Database:
PostgreSQL (managed Supabase) — NOT the host's MariaDB.
See docs/adr/0006-production-database-target.md and docs/deployment-runbook.md.
```

The MariaDB instance on the host is **not** used by the application and no port is
planned for it. Production is PostgreSQL-only, matching the Prisma datasource and the
PostgreSQL-specific features the implementation depends on.

## 73.1 Server Access

The deployment server is accessed through SSH:

```text
ssh root@76.13.98.31
```

**Security rule:** SSH passwords and other credentials must NOT be committed to `CLAUDE.md`, Git, `.env.example`, source code, logs, or deployment scripts.

The server credential supplied by the project owner must be entered interactively or stored in the deployment platform's secure secret store.

If this credential has been exposed outside the intended secure environment, rotate it before production deployment.

## 73.2 Database Configuration

Use environment variables for the production database connection.

Production uses the managed Supabase Postgres project (see ADR-0006). The single
required variable is `DATABASE_URL`, injected at deploy time into `apps/api/.env`
on the host.

```text
DATABASE_URL=<injected at deploy time; never committed>
```

The connection uses the Supabase session pooler (port 5432). Because the pooler caps
session-mode clients, the URL must also carry an explicit Prisma connection cap:

```text
?sslmode=require&connect_timeout=20&pool_timeout=20&connection_limit=5
```

Omitting `connection_limit` lets Prisma open `cpus*2+1` connections per process and
exhaust the pooler, producing `EMAXCONNSESSION` (HTTP 500) under load.

Do not place the production database password directly in:

```text
CLAUDE.md
.env.example
Git
Dockerfiles
source code
CI logs
terminal transcripts
application logs
```

The production database connection must be injected at deployment/runtime.

## 73.3 Production URL

The canonical ERP application URL is:

```text
https://erp.ienet.online
```

Production configuration should use HTTPS and must not silently fall back to an insecure HTTP origin.

## 73.4 Deployment Directory

The application is deployed at:

```text
/var/www/vhosts/ienet.online/erp.ienet.online
```

Deployment tooling must preserve:

```text
environment files
uploaded/private documents
database configuration
runtime-generated files
logs
persistent storage
```

Do not delete or replace persistent data during application deployment.

## 73.5 Deployment Procedure

Before deployment:

```text
1. Verify Git working tree.
2. Run tests.
3. Run typecheck.
4. Run lint.
5. Run production build.
6. Review migrations.
7. Back up the production database where required.
8. Confirm environment variables are present.
9. Confirm deployment directory.
10. Deploy application.
```

After deployment:

```text
1. Run required database migrations.
2. Restart/reload the application process.
3. Check application logs.
4. Verify https://erp.ienet.online.
5. Test authentication.
6. Test database connectivity.
7. Test organization scope.
8. Test one representative critical workflow.
9. Verify background jobs.
10. Verify no secrets appeared in logs.
```

Never run destructive database commands against production without explicit authorization.

## 73.6 Database URL Construction

The database URL is generated from secure runtime variables rather than hard-coded.

Conceptually:

```text
postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
```

Because the password may contain URL-sensitive characters, deployment tooling must
correctly URL-encode credentials when constructing a URI. In practice the managed
provider hands back a ready-made `postgresql://` URL, which is injected verbatim.

The MySQL/MariaDB URL construction form described in earlier revisions of this section
no longer applies — see §73.2.

## 73.7 Production Secret Policy

The following values are classified as secrets:

```text
SSH password
DB_PASSWORD
session secrets
JWT/signing secrets
OAuth secrets
SMTP passwords
SMS provider credentials
WhatsApp credentials
storage credentials
API keys
webhook signing secrets
```

Secrets must be supplied through:

```text
server environment
secure secret manager
CI/CD secret variables
hosting-provider secret configuration
```

They must never be committed to the repository.

## 73.8 Deployment Agent Rule

When Claude Code is asked to deploy:

```text
Inspect the deployment configuration first.
Do not print credentials.
Do not commit credentials.
Do not echo secret environment variables.
Do not expose DATABASE_URL in output.
Use the existing deployment directory.
Run migrations only after reviewing them.
Verify the application after deployment.
```

If credentials are required but unavailable through the secure environment, stop and request that the operator configure them securely rather than asking them to paste secrets into source files.

## 73.9 Live deployment topology

The application is live at `https://erp.ienet.online` on the Plesk host
`srv1290338.hstgr.cloud` (`76.13.98.31`).

```text
Browser
  → nginx (Plesk, :443, HTTP/2, Let's Encrypt cert)
  → Apache (Plesk, 127.0.0.1:7081, SSL vhost)
  → Next.js standalone  (pm2: neterp-web,  127.0.0.1:3000)
  → NestJS API          (pm2: neterp-api,  127.0.0.1:4000, global prefix /api/v1)
  → Supabase Postgres (session pooler, off-host)
```

The Next.js application fronts `/api/v1/*` with its own rewrite to the local API, so a
single reverse-proxy rule to port 3000 is sufficient. No public port is opened for the
API; both Node processes bind loopback only.

Key paths on the host:

```text
Checkout / build root:  /var/www/vhosts/ienet.online/erp.ienet.online/app
DocumentRoot:           /var/www/vhosts/ienet.online/erp.ienet.online
Reverse-proxy config:   /var/www/vhosts/system/erp.ienet.online/conf/vhost_ssl.conf
pm2 process list:       /root/.pm2/dump.pm2  (app/ecosystem.config.js)
Logs:                   /var/log/neterp/{api,web}.{out,err}.log
Uploads (local driver):  <checkout>/data/documents
```

Operational notes:

- The Plesk-generated `httpd.conf` / `nginx.conf` must never be edited; custom Apache
directives belong in `vhost_ssl.conf`, applied with
  `httpdmng --reconfigure-domain erp.ienet.online`.
- Only files inside the DocumentRoot's `app/` subdirectory hold the application. The
  DocumentRoot root itself must never contain scripts, credentials or a stray `.git`.
- The worker (BullMQ) is intentionally not deployed; it requires Redis.
- See `docs/deployment-runbook.md` for the build/redeploy/rollback procedure.
